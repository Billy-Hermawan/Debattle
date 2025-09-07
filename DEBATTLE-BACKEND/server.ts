// server.ts
import express from 'express';
import http from 'http';
import { initSockets } from './realtime/sockets';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
