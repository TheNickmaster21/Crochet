import {
    CROCHET_FOLDER_NAME, CrochetCore, EventDefinition, FunctionDefinition, OnHeartbeat, OnInit,
    OnStart
} from 'core';

export abstract class Controller {}

type ControllerConstructor = new () => Controller;

export class CrochetClientImplementation extends CrochetCore {
    private controllers = new Map<string, Controller>();

    private startPromise?: Promise<void>;

    public constructor() {
        super();

        this.CrochetFolder = script.Parent?.WaitForChild(CROCHET_FOLDER_NAME) as Folder;
        this.functionFolder = this.CrochetFolder.WaitForChild('Functions') as Folder;
        this.eventFolder = this.CrochetFolder.WaitForChild('Events') as Folder;
    }

    /** Start should be called once by the client to setup all controllers. Unlike on the server,
     *  the start() method on the ClientCrochet returns a promise that waits on the server to
     *  start. All OnInit() methods are called as soon as start() is called but all onStart()
     *  methods are called after all other onInit methods are called AND after the server starts.
     */
    public async start(): Promise<void> {
        if (this.startPromise === undefined) {
            this.startPromise = new Promise<void>((resolve) => {
                this.controllers.values().forEach((controller) => {
                    if ('onInit' in controller) {
                        (controller as OnInit).onInit();
                    }
                });

                Promise.spawn(() => {
                    script.Parent?.WaitForChild('Started');
                    this.controllers.values().forEach((controller) => {
                        if ('onStart' in controller) {
                            (controller as OnStart).onStart();
                        }
                        if ('onHeartbeat' in controller) {
                            game.GetService('RunService').Heartbeat.Connect((step) =>
                                (controller as OnHeartbeat).onHeartbeat(step)
                            );
                        }
                    });

                    resolve();
                });
            });
        }
        return this.startPromise;
    }

    public registerControllers(controllerConstructors: ControllerConstructor[]): void {
        controllerConstructors.forEach((controllerConstructor) => this.registerController(controllerConstructor));
    }

    public registerController(controllerConstructor: ControllerConstructor): void {
        assert(
            this.startPromise === undefined,
            'Controllers cannot be registered after start() has already been called!'
        );

        const controllerKey = tostring(controllerConstructor);
        assert(!this.controllers.has(controllerKey), `Duplicate controller for name ${controllerKey}!`);
        this.controllers.set(tostring(controllerConstructor), new controllerConstructor());
    }

    public getController<S extends ControllerConstructor>(controllerConstructor: S): InstanceType<S> {
        const controllerKey = tostring(controllerConstructor);
        assert(this.controllers.has(controllerKey), `No controller registered for name ${controllerKey}!`);
        return this.controllers.get(controllerKey) as InstanceType<S>;
    }

    public getServerSideRemoteFunction<A extends unknown[], R>(
        functionDefinition: FunctionDefinition<A, R>
    ): (...args: A) => R {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        return ((...args: A) => remoteFunction.InvokeServer(...args)) as (...args: A) => R;
    }

    public getServerSideRemotePromiseFunction<A extends unknown[], R>(
        functionDefinition: FunctionDefinition<A, R>
    ): (...args: A) => Promise<R> {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        return (...args: unknown[]) => {
            return new Promise((resolve) => Promise.spawn(() => resolve(remoteFunction.InvokeServer(...args) as R)));
        };
    }

    public bindClientSideRemoteFunction<A extends unknown[], R>(
        functionDefinition: FunctionDefinition<A, R>,
        functionBinding: (...args: A) => R
    ): void {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        remoteFunction.OnClientInvoke = functionBinding as (...args: unknown[]) => unknown;
    }

    public bindRemoteEvent<A extends unknown[]>(
        eventDefinition: EventDefinition<A>,
        functionBinding: (...args: A) => void
    ): RBXScriptConnection {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return remoteEvent.OnClientEvent.Connect(functionBinding as (...args: unknown[]) => void);
    }

    public getRemoteEventFunction<A extends unknown[]>(eventDefinition: EventDefinition<A>): (...args: A) => void {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return ((...args: A) => remoteEvent.FireServer(...args)) as (...args: A) => void;
    }
}
