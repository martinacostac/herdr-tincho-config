// herdr-standin <agent> <address> <name> [shell arguments...]
import { standin } from "./standin";
import { system } from "./system";

// Not awaited: a rejection goes to the stand-in's error handler, which keeps the process alive.
void standin(process.argv.slice(2), system());
