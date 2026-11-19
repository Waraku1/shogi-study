// Credential-free local fixture only. Profiles/SQLite state stay gitignored.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { platform, release } from 'node:os';
const require = createRequire(import.meta.url);
const { WebSocket: WS } = require(require.resolve('ws', {paths: [require.resolve('wrangler')]}));
const root = new URL('../', import.meta.url).pathname;
process.chdir(root);
const output = process.env.SHOGI_PROFILE_OUTPUT ?? 'work/gate-profile', state = output + '/state';
await mkdir(output, { recursive: true });
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const wrangler = ['exec', 'wrangler'];
const config = ['--config', 'wrangler.profile.json', '--persist-to', state];
const sql = command => execFileSync('pnpm', [...wrangler, 'd1', 'execute', 'shogi-local', '--local', ...config, '--command', command], {env, stdio: 'pipe'});
for (const name of ['0001_auth.sql', '0002_player_rooms.sql'])
  execFileSync('pnpm', [...wrangler, 'd1', 'execute', 'shogi-local', '--local', ...config, '--file', 'migrations/' + name], {env, stdio: 'pipe'});
sql('DELETE FROM player_rooms;');
const server = spawn('pnpm', [...wrangler, 'dev', '--local', ...config, '--port', '8791', '--inspector-port', '9231'], {env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
let log = '';
const liveLog = createWriteStream(output + '/server-running.log');
server.stdout.on('data', b => { log += b; liveLog.write(b); }); server.stderr.on('data', b => { log += b; liveLog.write(b); });
const origin = 'http://localhost:8791', appOrigin = 'http://localhost:5173';
const pause = ms => new Promise(r => setTimeout(r, ms));
let socket;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (/Ready on http:/.test(log)) { ready = true; break; }
    await pause(200);
  }
  if (!ready) throw new Error('Local profile Worker did not start');
  const targets = await (await fetch('http://127.0.0.1:9231/json')).json();
  socket = new WS(targets[0].webSocketDebuggerUrl, {headers:{Origin:'http://localhost:9231'}});
  await once(socket, 'open');
  let serial = 0; const waiting = new Map();
  socket.addEventListener('message', ({data}) => {
    const r = JSON.parse(data); if (!r.id) return;
    const p = waiting.get(r.id); if (!p) return; waiting.delete(r.id);
    clearTimeout(p.timer);
    if (r.error) p.reject(new Error(JSON.stringify(r.error))); else p.resolve(r.result);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('CDP timeout: '+method));},10000);
    waiting.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params}));
  });
  await cdp('Runtime.enable');
  await cdp('Profiler.enable'); await cdp('Profiler.setSamplingInterval', {interval: 100});
  // Linux aggregate process CPU: actual user+system ticks across all local workerd
  // descendants (Worker, D1/DO/dev proxy), not HTTP wait time or billed CPU.
  const hz = Number(execFileSync('getconf', ['CLK_TCK']).toString());
  async function cpu() {
    const entries = [];
    for (const id of await readdir('/proc')) if (/^\d+$/.test(id)) {
      try {
        const stat = await readFile(`/proc/${id}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        entries.push({id: Number(id), ppid: Number(fields[1]), name: stat.slice(stat.indexOf('(')+1, stat.lastIndexOf(')')), ticks: Number(fields[11]) + Number(fields[12])});
      } catch {}
    }
    const descendants = new Set([server.pid]);
    for (let i = 0; i < 8; i++) for (const p of entries) if (descendants.has(p.ppid)) descendants.add(p.id);
    return entries.filter(p => descendants.has(p.id) && p.name === 'workerd').reduce((n,p) => n+p.ticks, 0) * 1000/hz;
  }
  async function login(name) {
    const r = await fetch(origin + '/api/test/login', {method:'POST', headers:{Origin:appOrigin,'Content-Type':'application/json'}, body:JSON.stringify({name})});
    if (!r.ok) throw new Error('Fixture login failed');
    return r.headers.get('set-cookie').split(';')[0];
  }
  async function request(path, cookie=alice, method='GET') {
    const r = await fetch(origin+path, {method, headers:{Origin:appOrigin, Cookie:cookie}});
    const body = await r.text();
    return {status:r.status, body, rooms:Number(r.headers.get('X-Local-Room-Requests')), d1:Number(r.headers.get('X-Local-D1-Statements')), roomRoutes:(r.headers.get('X-Local-Room-Routes')??'').split(',').filter(Boolean)};
  }
  const coldCpuBefore=await cpu(), coldStarted=performance.now();
  const cold=await request('/api/me','');
  const coldFirstHttp={scope:'First HTTP request in this local profile process, before fixture logins. Not an edge cold-start/billed CPU measurement.',path:'/api/me',status:cold.status,wallMs:performance.now()-coldStarted,aggregateLocalWorkerdCpuMs:await cpu()-coldCpuBefore,rooms:cold.rooms,d1:cold.d1};
  if(cold.status!==401)throw new Error('Cold guest request failed');
  const alice = await login('alice'), bob = await login('bob');
  const results = [];
  async function measure(label, run, expected=200, repetitions=40) {
    const firstCpuBefore=await cpu(), firstStarted=performance.now(), first=await run();
    if(first.status!==expected)throw new Error(label+' first request failed');
    const firstObserved={scope:'First route observation after fixture setup in the same process; not a cold isolate.',wallMs:performance.now()-firstStarted,aggregateLocalWorkerdCpuMs:await cpu()-firstCpuBefore,rooms:first.rooms,d1:first.d1};
    for(let i=0;i<3;i++) if((await run()).status !== expected) throw new Error(label+' warmup failed');
    const times=[], counts=[];
    const before=await cpu();
    for(let i=0;i<repetitions;i++) {
      const t=performance.now(), r=await run(); times.push(performance.now()-t);
      if(r.status!==expected) throw new Error(label+' unexpected status '+r.status);
      counts.push({rooms:r.rooms,d1:r.d1,roomRoutes:r.roomRoutes??[]});
    }
    const cpuMs=await cpu()-before;
    await cdp('Profiler.start');
    for(let i=0;i<repetitions;i++) await run();
    const {profile}=await cdp('Profiler.stop');
    await writeFile(`${output}/${label}.cpuprofile`, JSON.stringify(profile));
    const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
    let activeUs=0;
    for(let i=0;i<(profile.samples?.length??0);i++) {
      const name=nodes.get(profile.samples[i])?.callFrame.functionName;
      if(name!=='(idle)' && name!=='(root)') activeUs+=profile.timeDeltas[i];
    }
    times.sort((a,b)=>a-b);
    const round=n=>Number(n.toFixed(3));
    const result={label,firstObserved,repetitions,httpStatus:expected,wallP50Ms:round(times[Math.floor(times.length*.5)]),wallP95Ms:round(times[Math.floor(times.length*.95)]),wallMaxMs:round(Math.max(...times)),aggregateLocalWorkerdCpuMs:round(cpuMs),aggregateCpuMeanMs:round(cpuMs/repetitions),sampledNonIdleMeanMs:round(activeUs/1000/repetitions),v8Samples:profile.samples?.length??0,maxRoomRequests:Math.max(...counts.map(c=>c.rooms)),maxD1Statements:Math.max(...counts.map(c=>c.d1)),roomRoutes:[...new Set(counts.flatMap(c=>c.roomRoutes))]};
    results.push(result); console.log(JSON.stringify(result));
  }
  await measure('me-unauthenticated',()=>request('/api/me',''),401);
  await measure('me-fixture-session',()=>request('/api/me'));
  let created=0; const ids=[];
  for(const count of [0,1,10,32]) {
    while(created<count) { const r=await request('/api/rooms',alice,'POST'); if(r.status!==200) throw new Error('Create failed'); ids.push(JSON.parse(r.body).id); created++; }
    await measure(`status-${count}-waiting`,()=>request('/api/play-status'));
  }
  const id=ids.sort()[0];
  // Same participant join is an idempotent recovery path, avoiding clock churn.
  await measure('join-existing-participant',()=>request(`/api/rooms/${id}/join`,alice,'POST'));
  // No inspector API token or WS cookies are recorded in output.
  await measure('websocket-upgrade',async()=>{
    return await new Promise((resolve,reject)=>{
      const ws=new WS(`ws://localhost:8791/api/rooms/${id}/ws`,{headers:{Origin:appOrigin,Cookie:alice}});
      ws.once('upgrade',r=>{const v={status:r.statusCode,rooms:Number(r.headers['x-local-room-requests']),d1:Number(r.headers['x-local-d1-statements']),roomRoutes:(r.headers['x-local-room-routes']??'').split(',').filter(Boolean)}; ws.once('open',()=>{ws.close();resolve(v);});});
      ws.once('error',reject);
    });
  },101,20);
  await measure('signin-initiation-fake',()=>request('/api/test/oauth-probe',alice,'POST'),200,20);
  // Legacy over-cap rows prove fail-closed cost is bounded, not a 128-room scan.
  sql("DELETE FROM player_rooms WHERE userId='alice'; INSERT INTO player_rooms(userId,roomId,pending) WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<128) SELECT 'alice',printf('legacy-%03d',x),0 FROM n;");
  await measure('status-128-legacy-rejected',()=>request('/api/play-status'),400);
  // Real Google callback requires credentials/network and is deliberately absent.
  await writeFile(`${output}/summary.json`, JSON.stringify({sourceSHA:execFileSync('git',['rev-parse','HEAD']).toString().trim(),dirty:!!execFileSync('git',['status','--porcelain']).toString().trim(),os:`${platform()} ${release()}`,wrangler:require(require.resolve('wrangler/package.json')).version,workerd:require(require.resolve('workerd/package.json',{paths:[require.resolve('wrangler')]})).version,method:'One first HTTP request; route-first observations; warm sequential batches. Aggregate Linux workerd user+system CPU ticks measured without profiler, separate 100us V8 non-idle sample estimates. Includes local DO/D1/proxy overhead. Not Workers billed CPU or per-request CPU percentiles/maxima.',node:process.version,cpuTickMs:1000/hz,coldFirstHttp,realOAuthCallback:'NOT TESTED',workersFreeCompliance:'UNVERIFIED',results},null,2)+'\n');
} finally {
  socket?.close();
  process.kill(-server.pid,'SIGTERM');
  liveLog.end();
  await writeFile(`${output}/server.log`,log);
}
