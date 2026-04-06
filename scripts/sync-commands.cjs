'use strict';

const path = require('path');

const { syncCommandAdapters, formatSummary } = require('../src/command-spec/sync');

function parseArgs(argv) {
  const args = { check: false, json: false, root: process.cwd(), target: null };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--check') {
      args.check = true;
      continue;
    }
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--root' && argv[i + 1]) {
      args.root = path.resolve(argv[++i]);
      continue;
    }
    if (token === '--target' && argv[i + 1]) {
      args.target = argv[++i];
      continue;
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const result = syncCommandAdapters({
      rootDir: args.root,
      check: args.check,
      targets: args.target,
    });

    if (args.json) {
      console.log(JSON.stringify({
        rootDir: result.rootDir,
        specs: result.specs.map(spec => spec.id),
        outputs: result.outputs,
        changedFiles: result.changedFiles,
        driftFiles: result.driftFiles,
        ok: result.ok,
      }, null, 2));
    } else {
      console.log(formatSummary(result));
      if (result.changedFiles.length > 0) {
        console.log('');
        console.log('Arquivos atualizados:');
        for (const file of result.changedFiles) {
          console.log(`- ${file}`);
        }
      }
      if (result.driftFiles.length > 0) {
        console.error('');
        console.error('Adapters fora de sync com a spec:');
        for (const file of result.driftFiles) {
          console.error(`- ${file}`);
        }
      }
    }

    if (args.check && !result.ok) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

main();
