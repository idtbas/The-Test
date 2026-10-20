// Hair generation worker: receives jobs, returns packed strands (transferable buffers).
import { generate } from './generate.js';

self.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    const t0 = performance.now();
    const res = generate(job);
    res.ms = performance.now() - t0;
    self.postMessage({ id, kind: job.kind, res }, [res.pts.buffer, res.attr.buffer, res.rootIdx.buffer, res.rootW.buffer]);
  } catch (err) {
    self.postMessage({ id, kind: job.kind, error: String(err && err.stack || err) });
  }
};
