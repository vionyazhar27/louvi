// Runs the logic tests in Node: node tests/run-node.mjs
import { run } from './tests.js';

const { failures } = await run();
process.exit(failures.length ? 1 : 0);
