import CommonClient from "./lib/client";
import { NodeWebSocketTypeOptions, IWSClientAdditionalOptions } from "./lib/client/client.types";
export declare class Client extends CommonClient {
    constructor(address?: string, autoconnect?: IWSClientAdditionalOptions & NodeWebSocketTypeOptions, reconnect?: (method: string, params: object | Array<any>) => number);
}
export { default as Server } from "./lib/server";
