import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";
import {
  Terminal,
  Github,
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:9000";
const PROXY_DOMAIN = import.meta.env.VITE_PROXY_URL || "localhost:8000";

const socket = io(API_URL);

const App = () => {
  const [repoUrl, setRepoUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [deployedUrl, setDeployedUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [deploymentId, setDeploymentId] = useState("");
  const [errorDetails, setErrorDetails] = useState(null);

  const logContainerRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Fetch History & Subscribe
  useEffect(() => {
    if (!deploymentId) return;

    const subscribeToLogs = () => {
      console.log("Emitting subscribe for:", `logs:${deploymentId}`);
      socket.emit("subscribe", `logs:${deploymentId}`);
    };

    // If already connected, subscribe immediately.
    // Otherwise, wait for the connection event.
    if (socket.connected) {
      subscribeToLogs();
    } else {
      socket.on("connect", subscribeToLogs);
    }

    const fetchLogs = async () => {
      try {
        const { data } = await axios.get(`${API_URL}/logs/${deploymentId}`);
        const previousLogs = data.logs.map((log) => log.log);
        setLogs(previousLogs);
      } catch (error) {
        console.error("Failed to fetch history:", error);
      }
    };

    fetchLogs();

    return () => {
      socket.off("connect", subscribeToLogs);
    };
  }, [deploymentId]);

  const handleDeploy = async (e) => {
    e.preventDefault();
    if (!repoUrl) return;

    setStatus("deploying");
    setLogs([]);
    setErrorDetails(null);
    setProjectId("");
    setDeploymentId("");

    try {
      const projectRes = await axios.post(`${API_URL}/project`, {
        name: `project-${Math.random().toString(36).substring(7)}`,
        gitUrl: repoUrl,
      });

      const { project } = projectRes.data.data;
      setProjectId(project.id);

      const deployRes = await axios.post(`${API_URL}/deploy`, {
        projectId: project.id,
      });

      const { deploymentId: newDeploymentId } = deployRes.data.data;
      setDeploymentId(newDeploymentId);
      setStatus("building");
      const protocol =
        window.location.hostname === "localhost" ? "http" : "https";
      const cleanDomain = PROXY_DOMAIN.replace(/^https?:\/\//, "");
      setDeployedUrl(`${protocol}://${project.subDomain}.${cleanDomain}`);
    } catch (error) {
      console.error(error);
      setStatus("error");
      setErrorDetails(error.message);
    }
  };

  // Redeploy Function (Reuses existing Project ID)
  const handleRedeploy = async () => {
    if (!projectId) return;

    setStatus("deploying");
    setLogs([]);
    setErrorDetails(null);

    try {
      const deployRes = await axios.post(`${API_URL}/deploy`, {
        projectId: projectId,
      });

      const { deploymentId: newDeploymentId } = deployRes.data.data;
      setDeploymentId(newDeploymentId);
      setStatus("building");
    } catch (error) {
      setStatus("error");
      setErrorDetails(error.message);
    }
  };

  useEffect(() => {
  const onMessage = (message) => {
    console.log("Incoming log:", message);
    setLogs((prev) => [...prev, message]);

    // Handle success transition inside the listener without depending on 'status'
    if (message.toLowerCase().includes("upload completed")) {
      setTimeout(() => setStatus("success"), 2000);
    }
  };

  socket.on("message", onMessage);
  
  // Clean up only on component unmount
  return () => {
    socket.off("message", onMessage);
  };
}, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center p-4 font-sans selection:bg-blue-500/30">
      <div className="mb-10 text-center space-y-2">
        <h1 className="text-5xl font-extrabold bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-500 bg-clip-text text-transparent">
          Sketch VC
        </h1>
        <p className="text-slate-400 text-lg">
          Deploy from GitHub to Web in seconds.
        </p>
      </div>

      <div className="w-full max-w-3xl bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-xl shadow-2xl overflow-hidden ring-1 ring-white/10">
        {/* Input Section */}
        <div className="p-8 border-b border-slate-800 bg-slate-900/80">
          <form onSubmit={handleDeploy} className="flex gap-4">
            <div className="relative flex-1 group">
              <Github className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-5 h-5 group-focus-within:text-blue-400 transition-colors" />
              <input
                type="url"
                placeholder="https://github.com/username/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                disabled={status === "building" || status === "deploying"}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg py-4 pl-10 pr-4 text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={
                status === "building" || status === "deploying" || !repoUrl
              }
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-8 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-900/20 active:scale-95"
            >
              {status === "deploying" ? (
                <Loader2 className="animate-spin" />
              ) : (
                "Deploy"
              )}
            </button>
          </form>
        </div>

        {/* Error Banner */}
        {status === "error" && errorDetails && (
          <div className="bg-red-500/10 border-b border-red-500/20 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-red-400 font-medium text-sm">
                Deployment Failed
              </h3>
              <p className="text-red-300/80 text-xs leading-relaxed">
                {errorDetails}
              </p>
            </div>
          </div>
        )}

        {/* Info Bar */}
        {projectId && (
          <div className="px-8 py-3 bg-slate-950/50 border-b border-slate-800 flex items-center gap-6 text-xs font-mono text-slate-500">
            <div className="flex items-center gap-2">
              <span className="uppercase tracking-wider">Project ID:</span>
              <span className="text-slate-300">
                {projectId.split("-")[0]}...
              </span>
            </div>
            {deploymentId && (
              <div className="flex items-center gap-2">
                <span className="uppercase tracking-wider">Deployment ID:</span>
                <span className="text-slate-300">
                  {deploymentId.split("-")[0]}...
                </span>
              </div>
            )}
          </div>
        )}

        {/* Logs Section */}
        {status !== "idle" && (
          <div className="p-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-400">
                <Terminal className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-mono font-medium">
                  Build Logs
                </span>
              </div>
              {status === "success" && (
                <span className="px-3 py-1 bg-green-500/10 text-green-400 text-xs font-medium rounded-full flex items-center gap-1.5 border border-green-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Deployed
                </span>
              )}
            </div>
            <div
              ref={logContainerRef}
              className="bg-[#0c0c0c] rounded-lg p-4 h-80 overflow-y-auto font-mono text-xs md:text-sm custom-scrollbar border border-slate-800/50"
            >
              {status === "error" ? (
                <div className="flex flex-col items-center justify-center h-full text-red-400 gap-2">
                  <AlertCircle className="w-8 h-8" />
                  <span>{errorDetails}</span>
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-700" />
                  <span className="italic">
                    Initializing build environment...
                  </span>
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, index) => (
                    <div
                      key={index}
                      className="break-all hover:bg-white/5 py-0.5 px-2 -mx-2 rounded transition-colors flex items-start"
                    >
                      <span className="text-blue-500/70 select-none mr-3 shrink-0 font-mono text-xs mt-1">
                        $
                      </span>
                      <span
                        className={`font-mono text-xs md:text-[13px] leading-relaxed italic tracking-tight ${
                          log.toLowerCase().includes("error")
                            ? "text-red-400 font-semibold"
                            : "text-emerald-400/90"
                        }`}
                        style={{
                          textShadow: "0 0 8px rgba(52, 211, 153, 0.2)",
                        }}
                      >
                        {log}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Redeploy Button (Only shows on Error) */}
        {status === "error" && (
          <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex justify-end">
            <button
              onClick={handleRedeploy}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-medium transition-colors border border-slate-700"
            >
              <RefreshCw className="w-4 h-4" />
              Redeploy
            </button>
          </div>
        )}

        {/* Success Footer */}
        {status === "success" && (
          <div className="p-8 border-t border-slate-800 bg-gradient-to-b from-slate-900/50 to-slate-900/80">
            <div className="flex flex-col gap-3">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                App Deployed To
              </span>
              <div className="flex items-center gap-3 bg-slate-950 border border-slate-700 rounded-lg p-3 group">
                <a
                  href={deployedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-sm md:text-base font-medium break-all flex-1 transition-colors"
                >
                  {deployedUrl}
                </a>
                <a
                  href={deployedUrl}
                  target="_blank"
                  className="p-2 hover:bg-slate-800 rounded-md text-slate-400 hover:text-white transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
            <button
              onClick={() => {
                setStatus("idle");
                setLogs([]);
                setRepoUrl("");
              }}
              className="mt-6 text-sm text-slate-500 hover:text-white transition-colors w-full text-center hover:bg-slate-800 py-2 rounded-lg"
            >
              Start New Deployment
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
