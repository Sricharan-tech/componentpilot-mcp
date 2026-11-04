import { ComponentPilotService } from "./service.js";
import { TinyFishFetchReader } from "./tinyfish.js";

const result = await new ComponentPilotService(new TinyFishFetchReader()).healthCheck();
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "ok" ? 0 : 1;
