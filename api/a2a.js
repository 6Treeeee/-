import { a2aPublicKeys } from "../config/a2a-public-keys.js";
import { createA2AHttpHandler } from "../src/a2a/http-handler.js";

export default createA2AHttpHandler({ publicKeys: a2aPublicKeys });
