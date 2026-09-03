import { createOrchestrator } from '../packages/orchestrator/dist/index.js';
import { ExamplePlugin } from '../packages/plugins/example-task/dist/index.js';

let orchestratorPromise;
const getOrchestrator = () => (orchestratorPromise ||= createOrchestrator([ExamplePlugin],process.env.GEMINI_API_KEY));

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.url === '/health' || req.url === '/') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, service: 'arabic-github-agent', runtime: 'vercel' }));
  }
  if (req.method !== 'POST' || req.url !== '/agent/run/stream') {
    res.statusCode = 404; return res.end(JSON.stringify({ error: 'Not found' }));
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  let goal;
  try { goal = JSON.parse(body || '{}'); } catch { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
  if (!goal.intent || !goal.parameters) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'intent and parameters are required' })); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('status', { stage: 'planning', message: 'جاري اختيار المهمة' });
  try {
    const { run } = await getOrchestrator();
    send('status', { stage: 'executing', message: 'جاري التنفيذ عبر بوابة الموافقة' });
    const report = await run(goal);
    send('result', report); send('done', { success: report.success });
  } catch (error) { send('error', { message: error instanceof Error ? error.message : String(error) }); }
  res.end();
}
