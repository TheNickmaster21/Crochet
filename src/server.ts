import {
    CROCHET_FOLDER_NAME, CrochetCore, EventDefinition, FunctionDefinition, OnHeartbeat, OnInit,
    OnStart
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
        this.functionFolder = new Instance('Folder', this.CrochetFolder);
        this.functionFolder.Name = 'Functions';
        this.eventFolder = new Instance('Folder', this.CrochetFolder);
        this.eventFolder.Name = 'Events';
    }

    public registerServices(serviceConstructors: ServiceConstructor[]): void {
        serviceConstructors.forEach((serviceConstructor) => this.registerService(serviceConstructor));
    }

    public registerService(serviceConstructor: ServiceConstructor): void {
        assert(!this.starting, 'Services cannot be registered after start() has already been called!');

        const serviceKey = tostring(serviceConstructor);
        assert(!this.services.has(serviceKey), `Duplicate service for name ${serviceKey}!`);
        this.services.set(tostring(serviceConstructor), new serviceConstructor());
    }

    public getService<S extends ServiceConstructor>(serviceConstructor: S): InstanceType<S> {
        const serviceKey = tostring(serviceConstructor);
        assert(this.services.has(serviceKey), `No service registered for name ${serviceKey}!`);
        return this.services.get(serviceKey) as InstanceType<S>;
    }

    public registerRemoteFunction<A extends unknown[], R>(functionDefinition: FunctionDefinition<A, R>): void {
        const name = functionDefinition.functionIdentifier;
        const remoteFunction = new Instance('RemoteFunction');
        remoteFunction.Name = name;
        remoteFunction.Parent = this.functionFolder;
    }

    public bindServerSideRemoteFunction<A extends unknown[], R>(
        functionDefinition: FunctionDefinition<A, R>,
        functionBinding: (player: Player, ...args: A) => R
    ): void {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        remoteFunction.OnServerInvoke = functionBinding as (player: Player, ...args: unknown[]) => unknown;
    }

    public getClientSideRemoteFunction<A extends unknown[], R>(
        functionDefinition: FunctionDefinition<A, R>
    ): (player: Player, ...args: A) => R {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        return ((player: Player, ...args: A) => remoteFunction.InvokeClient(player, ...args)) as (
            player: Player,
            ...args: A
        ) => R;
    }

    public getClientSideRemotePromiseFunction<A extends unknown[], R>(
        functionDefinition: FunctionDefinition<A, R>
    ): (player: Player, ...args: A) => Promise<R> {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        return (player: Player, ...args: unknown[]) => {
            return new Promise((resolve) =>
                Promise.spawn(() => resolve(remoteFunction.InvokeClient(player, ...args) as R))
            );
        };
    }

    public registerRemoteEvent<A extends unknown[]>(eventDefinition: EventDefinition<A>): void {
        const name = eventDefinition.eventIdentifier;
        const remoteEvent = new Instance('RemoteEvent');
        remoteEvent.Name = name;
        remoteEvent.Parent = this.eventFolder;
    }

    public bindRemoteEvent<A extends unknown[]>(
        eventDefinition: EventDefinition<A>,
        functionBinding: (player: Player, ...args: A) => void
    ): RBXScriptConnection {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return remoteEvent.OnServerEvent.Connect(functionBinding as (player: Player, ...args: unknown[]) => void);
    }

    public getRemoteEventFunction<A extends unknown[]>(
        eventDefinition: EventDefinition<A>
    ): (player: Player, ...args: A) => void {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return ((player: Player, ...args: A) => remoteEvent.FireClient(player, ...args)) as (
            player: Player,
            ...args: A
        ) => void;
    }

    public getRemoteEventAllFunction<A extends unknown[]>(eventDefinition: EventDefinition<A>): (...args: A) => void {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return ((...args: A) => remoteEvent.FireAllClients(...args)) as (...args: A) => void;
    }

    public start(): void {
        assert(!this.starting, 'start() has already been called!');
        this.starting = true;

        this.services.values().forEach((service) => {
            if ('onInit' in service) {
                (service as OnInit).onInit();
            }
        });

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
