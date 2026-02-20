const express = require('express')
const httpproxy = require('http-proxy');
require('dotenv').config()
const { PrismaClient } = require('../api-server/node_modules/@prisma/client');

const app = express();

const prisma = new PrismaClient();

const BASE_PATH = process.env.BASE_PATH;
const PORT = process.env.PORT || 8000;

const proxy = httpproxy.createProxy();

app.use(async (req, res) => {
    const hostname = req.hostname;
    const subdomain = hostname.split('.')[0];

    if (!BASE_PATH) {
        console.error('CRITICAL ERROR: BASE_PATH is undefined. Check your .env file.');
        return res.status(500).send('Internal Server Configuration Error');
    }

    const project = await prisma.project.findFirst({
        where: {
            OR: [
                { subDomain: subdomain },
                // { customDomain: hostname } Need to add this in future
            ]
        }
    });

    if (!project) return res.status(404).send('Project not found');

    const resolvesTo = `${BASE_PATH}${project.id}`;

    if (req.url === '/') {
        req.url = '/index.html';
    }

    console.log(`Resolving to ${resolvesTo}`);

    return proxy.web(req, res, { target: resolvesTo, changeOrigin: true });
});

app.listen(PORT, () => {
    console.log(`S3 Reverse Proxy running on port ${PORT}`);
});
