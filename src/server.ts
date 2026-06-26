import express from 'express';
import cors from 'cors';
import { Server } from 'http';
import { EventEmitter } from 'events';

// This emitter is the bridge between the server and the main extension
export const eventEmitter = new EventEmitter();

let server: Server | null = null;
const app = express();
const PORT = 3000; // The port our server will listen on

// Middleware setup
app.use(cors()); // Allow requests from the Chrome extension
app.use(express.json({ limit: '50mb' })); // Allow large JSON payloads (for image data)

// The single endpoint for receiving data from Chrome
app.post('/handoff', (req, res) => {
    console.log('[Server] Received a POST request on /handoff');
    
    // Emit an event with the payload for the main extension to catch
    eventEmitter.emit('handoffReceived', req.body);
    
    // Respond to the Chrome extension to let it know the data was received
    res.status(200).send({ status: 'success', message: 'Data received by VS Code' });
});

export function startServer() {
    if (!server) {
        server = app.listen(PORT, () => {
            console.log(`[Server] Guide2Cypress listener started on http://localhost:${PORT}`);
        });
    }
}

export function stopServer() {
    if (server) {
        server.close(() => {
            console.log('[Server] Guide2Cypress listener stopped.');
            server = null;
        });
    }
}