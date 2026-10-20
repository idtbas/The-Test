// Hair generation worker: receives jobs, returns packed strands (transferable buffers).
import { generate } from './generate.js';

const TEX_W = 4096;   // must match HairSystem's texture width

self.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    const t0 = performance.now();
    const res = generate(job);
    // pad the points to whole rows of the 4096-wide float texture, so the main thread can
    // upload this buffer as is instead of copying it
    const rows = Math.ceil((res.N * res.K) / TEX_W);
    if (res.pts.length !== rows * TEX_W * 4) {
      const padded = new Float32Array(rows * TEX_W * 4);
      padded.set(res.pts);
      res.pts = padded;
    }
    res.ms = performance.now() - t0;
    self.postMessage({ id, kind: job.kind, res }, [res.pts.buffer, res.attr.buffer, res.rootIdx.buffer, res.rootW.buffer]);
  } catch (err) {
    self.postMessage({ id, kind: job.kind, error: String(err && err.stack || err) });
  }
};
