const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const { Kafka } = require('kafkajs');

const PROJECT_ID = process.env.PROJECT_ID;
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID;
const GIT_REPO_URL = process.env.GIT_REPO_URL;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_REGION;
const KAFKA_BROKER = process.env.KAFKA_BROKER;
const KAFKA_USERNAME = process.env.KAFKA_USERNAME;
const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD;
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;

const s3Client = new S3Client({
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
    region: AWS_REGION
});

const kafka = new Kafka({
    clientId: `docker-builder-${PROJECT_ID}`,
    brokers: [KAFKA_BROKER],
    ssl: {
        ca: [fs.readFileSync(path.join(__dirname, 'kafka.pem'), 'utf-8')]
    },
    sasl: {
        username: KAFKA_USERNAME,
        password: KAFKA_PASSWORD,
        mechanism: 'plain'
    }
});

const producer = kafka.producer();

async function publishLog(log) {
    await producer.send({
        topic: 'container-logs',
        messages: [
            {
                key: 'log',
                value: JSON.stringify({ PROJECT_ID, DEPLOYMENT_ID, log })
            }
        ]
    });
}

// Helper to run shell commands and stream logs
function runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        const p = exec(command, { cwd });

        p.stdout.on('data', async (data) => {
            console.log(data.toString());
            await publishLog(data.toString());
        });

        p.stderr.on('data', async (data) => {
            console.error(data.toString());
            await publishLog(data.toString());
        });

        p.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command failed with code ${code}`));
            }
        });
    });
}

async function init() {
    try {
        await producer.connect();
        console.log('Build Service Started...');
        await publishLog('Build Service Started...');

        const outDir = path.join(__dirname, 'output');

        // STEP 1: CLONE REPO
        console.log(`Cloning ${GIT_REPO_URL}...`);
        await publishLog(`Cloning ${GIT_REPO_URL}...`);
        
        try {
            await runCommand(`git clone ${GIT_REPO_URL} .`, outDir);
        } catch (error) {
            // This catches private repo errors!
            console.error("Cloning failed");
            await publishLog("Error: Authentication failed (Private Repo?) or Invalid URL");
            await publishLog("Error: Could not clone repository.");
            process.exit(1); // Stop here
        }

        // STEP 2: FRAMEWORK CONFIGURATION
        console.log('Checking for frameworks...');
        const packageJsonPath = path.join(outDir, 'package.json');
        
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

            if (dependencies['react-scripts']) {
                console.log('Detected Create React App');
                await publishLog('Detected Create React App. Applying fix...');
                packageJson.homepage = '.';
                fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
            } 
            else if (dependencies['vite']) {
                console.log('Detected Vite');
                await publishLog('Detected Vite. Applying fix...');
                // Modify build script safely
                if (packageJson.scripts && packageJson.scripts.build) {
                    packageJson.scripts.build = packageJson.scripts.build.replace('vite build', 'vite build --base=./');
                    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
                }
            }
        }

        // STEP 3: INSTALL & BUILD
        console.log('Installing dependencies...');
        await publishLog('Installing dependencies...');
        await runCommand('npm install', outDir);

        console.log('Building project...');
        await publishLog('Building project...');
        await runCommand('npm run build', outDir);

        // STEP 4: UPLOAD TO S3
        console.log(`Build complete`);
        await publishLog('Build complete');

        let buildPath = path.join(outDir, 'dist');
        if (!fs.existsSync(buildPath)) {
            buildPath = path.join(outDir, 'build');
            await publishLog('Checking build folder...');
        }
        
        if (!fs.existsSync(buildPath)) {
            const err = 'Error: Could not find build folder (dist/ or build/)';
            console.error(err);
            await publishLog(err);
            process.exit(1);
        }

        const buildContents = fs.readdirSync(buildPath, { recursive: true });
        
        console.log('Upload started...');
        await publishLog('Upload started...');

        for (const file of buildContents) {
            const filePath = path.join(buildPath, file);
            if (fs.lstatSync(filePath).isDirectory()) continue;

            const command = new PutObjectCommand({
                Bucket: AWS_BUCKET_NAME,
                Key: `__outputs/${PROJECT_ID}/${file}`,
                Body: fs.createReadStream(filePath),
                ContentType: mime.lookup(filePath) || 'application/octet-stream',
            });

            await s3Client.send(command);
            console.log(`Uploaded ${file}`);
            await publishLog(`Uploaded ${file}`);
        }

        console.log('Upload completed');
        await publishLog('Upload completed');
        
        // Wait briefly to ensure logs flush before exiting
        setTimeout(() => {
            process.exit(0);
        }, 2000);

    } catch (error) {
        console.error(error);
        await publishLog('Error: ' + error.message);
        setTimeout(() => {
            process.exit(1);
        }, 2000);
    }
}

init();