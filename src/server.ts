import {
    CROCHET_FOLDER_NAME, CrochetCore, EventDefinition, FunctionDefinition, OnHeartbeat, OnInit,
    OnStart, UnknownFunction
} from 'core';

export abstract class Service {}

type ServiceConstructor = new () => Service;

export class CrochetServerImplementation extends CrochetCore {
    private services = new Map<string, Service>();

    private starting: boolean = false;

    public constructor() {
        super();

        this.CrochetFolder = new Instance('Folder');
        this.CrochetFolder.Name = CROCHET_FOLDER_NAME;
        this.FunctionFolder = new Instance('Folder', this.CrochetFolder);
        this.FunctionFolder.Name = 'Functions';
        this.EventFolder = new Instance('Folder', this.CrochetFolder);
        this.EventFolder.Name = 'Events';
    }

    /**
     * Register mulitple services at once.
     *
     * @param serviceConstructors The constuctors of multiple services being registered
     * @throws Services can only be registered before start() has been called
     * @throws Services can only be registered once
     */
    public registerServices(serviceConstructors: ServiceConstructor[]): void {
        serviceConstructors.forEach((serviceConstructor) => this.registerService(serviceConstructor));
    }

    /**
     * Register a service. Once a service is registered, it's onInit method will be called (if one
     * exists). Once services are registered, they can be retreived on the server by calling getService().
     *
     * @param serviceConstructor The constructor of the Service being registered
     * @throws Services can only be registered before start() has been called
     * @throws Services can only be registered once
     *
     * @example CrochetServer.registerService(MyService);
     */
    public registerService(serviceConstructor: ServiceConstructor): void {
        assert(!this.starting, 'Services cannot be registered after start() has already been called!');

        const serviceKey = tostring(serviceConstructor);
        assert(!this.services.has(serviceKey), `Duplicate service for name ${serviceKey}!`);
        const service = new serviceConstructor();
        this.services.set(tostring(serviceConstructor), service);

        if ('onInit' in service) {
            (service as OnInit).onInit();
        }
    }

    /**
     * Retreive the service for a given Service class.
     *
     * @param serviceConstructor
     * @return A singleton implementation of the give serviceContructor
     * @throws The given serviceConstructor must have been registered before this method is called!
     *
     * @example CrochetServer.getService(MyService); // Returns MyService instance
     */
    public getService<S extends ServiceConstructor>(serviceConstructor: S): InstanceType<S> {
        const serviceKey = tostring(serviceConstructor);
        assert(this.services.has(serviceKey), `No service registered for name ${serviceKey}!`);
        return this.services.get(serviceKey) as InstanceType<S>;
    }

    public registerRemoteFunction<F extends UnknownFunction>(functionDefinition: FunctionDefinition<F>): void {
        const name = functionDefinition.functionIdentifier;
        const remoteFunction = new Instance('RemoteFunction');
        remoteFunction.Name = name;
        remoteFunction.Parent = this.FunctionFolder;
        if (functionDefinition.parameterTypeguards) {
            this.functionParameterTypeGuards.set(name, functionDefinition.parameterTypeguards);
        }
        if (functionDefinition.returnTypeGuard) {
            this.functionReturnTypeGuard.set(name, functionDefinition.returnTypeGuard);
        }
    }

    public bindServerSideRemoteFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>,
        functionBinding: (player: Player, ...params: Parameters<F>) => ReturnType<F>
    ): void {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        remoteFunction.OnServerInvoke = ((player: Player, ...params: Parameters<F>) => {
            assert(
                this.verifyFunctionParametersWithDefinition(params, functionDefinition),
                `Parameters are wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            const result = functionBinding(player, ...params) as ReturnType<F>;
            assert(
                this.verifyFunctionReturnTypeWithDefinition(result, functionDefinition),
                `Return type is wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            return result;
        }) as (player: Player, ...params: unknown[]) => unknown;
    }

    /**
     * @deprecated Client Side RemoteFunctions are unsafe. (See https://developer.roblox.com/en-us/articles/Remote-Functions-and-Events#remote-function-warning)
     */
    public getClientSideRemoteFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>
    ): (player: Player, ...params: Parameters<F>) => ReturnType<F> {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;

        return (player: Player, ...params: Parameters<F>) => {
            assert(
                this.verifyFunctionParametersWithDefinition(params, functionDefinition),
                `Parameters are wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            const result = remoteFunction.InvokeClient(player, ...params) as ReturnType<F>;
            assert(
                this.verifyFunctionReturnTypeWithDefinition(result, functionDefinition),
                `Return type is wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            return result;
        };
    }

    /**
     * @deprecated Client Side RemoteFunctions are unsafe. (See https://developer.roblox.com/en-us/articles/Remote-Functions-and-Events#remote-function-warning)
     */
    public getClientSideRemotePromiseFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>
    ): (player: Player, ...params: Parameters<F>) => Promise<ReturnType<F>> {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        return (player: Player, ...params: unknown[]) => {
            assert(
                this.verifyFunctionParametersWithDefinition(params, functionDefinition),
                `Parameters are wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            return new Promise((resolve) =>
                Promise.spawn(() => {
                    const result = remoteFunction.InvokeClient(player, ...params) as ReturnType<F>;
                    assert(
                        this.verifyFunctionReturnTypeWithDefinition(result, functionDefinition),
                        `Return type is wrong for the function ${functionDefinition.functionIdentifier}!`
                    );
                    resolve(result);
                })
            );
        };
    }

    public registerRemoteEvent<A extends unknown[]>(eventDefinition: EventDefinition<A>): void {
        const name = eventDefinition.eventIdentifier;
        const remoteEvent = new Instance('RemoteEvent');
        remoteEvent.Name = name;
        remoteEvent.Parent = this.EventFolder;
        if (eventDefinition.parameterTypeguards) {
            this.eventParameterTypeGuards.set(name, eventDefinition.parameterTypeguards);
        }
    }

    public bindRemoteEvent<A extends unknown[]>(
        eventDefinition: EventDefinition<A>,
        functionBinding: (player: Player, ...params: A) => void
    ): RBXScriptConnection {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return remoteEvent.OnServerEvent.Connect(((player: Player, ...params: A) => {
            assert(
                this.verifyEventParametersWithDefinition(params, eventDefinition),
                `Parameters are wrong for the event ${eventDefinition.eventIdentifier}!`
            );
            functionBinding(player, ...params);
        }) as (player: Player, ...params: unknown[]) => void);
    }

    public getRemoteEventFunction<A extends unknown[]>(
        eventDefinition: EventDefinition<A>
    ): (player: Player, ...params: A) => void {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return ((player: Player, ...params: A) => {
            assert(
                this.verifyEventParametersWithDefinition(params, eventDefinition),
                `Parameters are wrong for the event ${eventDefinition.eventIdentifier}!`
            );
            remoteEvent.FireClient(player, ...params);
        }) as (player: Player, ...params: A) => void;
    }

    public getRemoteEventAllFunction<A extends unknown[]>(eventDefinition: EventDefinition<A>): (...params: A) => void {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return ((...params: A) => {
            assert(
                this.verifyEventParametersWithDefinition(params, eventDefinition),
                `Parameters are wrong for the event ${eventDefinition.eventIdentifier}!`
            );
            remoteEvent.FireAllClients(...params);
        }) as (...params: A) => void;
    }

    public start(): void {
        assert(!this.starting, 'start() has already been called!');
        this.starting = true;

        this.CrochetFolder!.Parent = script.Parent;

        this.services.values().forEach((service) => {
            if ('onStart' in service) {
                (service as OnStart).onStart();
            }
            if ('onHeartbeat' in service) {
                game.GetService('RunService').Heartbeat.Connect((step) => (service as OnHeartbeat).onHeartbeat(step));
            }
        });

        const setup = new Instance('BoolValue');
        setup.Name = 'Started';
        setup.Parent = script.Parent;
    }
}
