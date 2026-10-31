import {
  formatDoctor,
  parseDoctorArgs,
  runDoctor,
} from "./lib/local-doctor.mjs";

try {
  const options = parseDoctorArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: pnpm local:doctor [--offline] [--json] [--web-url http://127.0.0.1:3000]\nRead-only local checks; no migrations, signatures, or service startup.\nExit codes: 0 requested checks passed; 1 readiness blocker; 2 invalid options or internal failure.\n",
    );
  } else {
    const report = await runDoctor(options);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatDoctor(report),
    );
    process.exitCode = report.ok ? 0 : 1;
  }
} catch {
  // Raw parser, filesystem, RPC, and key errors can contain credentials.
  process.stderr.write(
    "Doctor could not run. Check options with pnpm local:doctor --help and confirm Node 22.12+ within 22.x. No raw error or environment values are printed.\n",
  );
  process.exitCode = 2;
}
