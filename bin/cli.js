#!/usr/bin/env node
// Tiny shim: just runs the bundled Node entry. Real CLI logic lives in src/node.ts.
import('../dist/node.js')
  .then((m) => m.main())
  .catch((err) => {
    console.error('[imgtokenx] failed to start:', err);
    // Only suggest a rebuild when dist/ is actually missing — operational
    // errors (config ambiguity, port in use) carry their own instructions.
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('[imgtokenx] did you forget to `npm run build`?');
    }
    process.exit(1);
  });
