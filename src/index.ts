import { CrochetClientImplementation } from 'client';
import { CrochetServerImplementation } from 'server';

export { Controller } from 'client';
export { Service } from 'server';
export { OnInit, OnStart, OnHeartbeat, EventDefinition, FunctionDefinition } from 'core';

const RunService = game.GetService('RunService');

function getErroringObject(errorMessage: string): unknown {
    return setmetatable(
        {},
        {
            __index() {
                error(errorMessage);
            }
        }
    );
}

export const CrochetServer: CrochetServerImplementation = RunService.IsServer()
    ? new CrochetServerImplementation()
    : (getErroringObject('CrochetServer can only be used on the Server!') as CrochetServerImplementation);

export const CrochetClient: CrochetClientImplementation = RunService.IsClient()
    ? new CrochetClientImplementation()
    : (getErroringObject('CrochetClient can only be used on the Client!') as CrochetClientImplementation);
