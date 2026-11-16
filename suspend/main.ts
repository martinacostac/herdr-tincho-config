// herdr-standin <agent> <address> <name>
import { standin } from "./standin";
import { system } from "./system";

await standin(process.argv.slice(2), system());
