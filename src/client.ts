import {
    CROCHET_FOLDER_NAME, CrochetCore, EventDefinition, FunctionDefinition, OnHeartbeat, OnInit,
    OnStart, UnknownFunction
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

    /**
     * Start should be called once by the client to setup all controllers. Unlike on the server,
     * the start() method on the ClientCrochet returns a promise that waits on the server to
     * start. All OnInit() methods are called as soon as start() is called but all onStart()
     * methods are called after all other onInit methods are called AND after the server starts.
     */
    public async start(): Promise<void> {
        if (this.startPromise === undefined) {
            this.startPromise = new Promise<void>((resolve) => {
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

    /**
     *  Register mulitple controllers at once.
     *
     * @param controllerConstructors The constuctors of multiple controllers being registered
     * @throws Controllers can only be registered before start() has been called
     * @throws Controllers can only be registered once
     */
    public registerControllers(controllerConstructors: ControllerConstructor[]): void {
        controllerConstructors.forEach((controllerConstructor) => this.registerController(controllerConstructor));
    }

    /**
     *  Register a controller. Once a controller is registered, it's onInit method will be called (if one
     *  exists). Once controllers are registered, they can be retreived on the server by calling getController().
     *
     * @param controllerConstructor  The constructor of the Controller being registered
     * @throws Controllers can only be registered before start() has been called
     * @throws Controllers can only be registered once
     *
     * @example CrochetClient.registerController(MyController);
     *  */
    public registerController(controllerConstructor: ControllerConstructor): void {
        assert(
            this.startPromise === undefined,
            'Controllers cannot be registered after start() has already been called!'
        );

        const controllerKey = tostring(controllerConstructor);
        assert(!this.controllers.has(controllerKey), `Duplicate controller for name ${controllerKey}!`);
        const controller = new controllerConstructor();
        this.controllers.set(tostring(controllerConstructor), controller);

        if ('onInit' in controller) {
            (controller as OnInit).onInit();
        }
    }

    /**
     * Retreive the controller for a given Controller class.
     *
     * @param controllerConstructor
     * @return A singleton implementation of the give controllerConstructor
     * @throws The given controllerConstructor must have been registered before this method is called!
     *
     * e.g. CrochetClient.getController(MyController); // Returns MyController instance
     */
    public getController<S extends ControllerConstructor>(controllerConstructor: S): InstanceType<S> {
        const controllerKey = tostring(controllerConstructor);
        assert(this.controllers.has(controllerKey), `No controller registered for name ${controllerKey}!`);
        return this.controllers.get(controllerKey) as InstanceType<S>;
    }

    public getServerSideRemoteFunction<F extends UnknownFunction>(functionDefinition: FunctionDefinition<F>): F {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        return ((...params: Parameters<F>) => remoteFunction.InvokeServer(...params)) as F;
    }

    public getServerSideRemotePromiseFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>
    ): (...params: Parameters<F>) => Promise<ReturnType<F>> {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        return (...params: unknown[]) => {
            return new Promise((resolve) =>
                Promise.spawn(() => resolve(remoteFunction.InvokeServer(...params) as ReturnType<F>))
            );
        };
    }

    /**
     * @deprecated Client Side RemoteFunctions are unsafe. (See https://developer.roblox.com/en-us/articles/Remote-Functions-and-Events#remote-function-warning)
     */
    public bindClientSideRemoteFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>,
        functionBinding: F
    ): void {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        remoteFunction.OnClientInvoke = functionBinding as F;
    }

    public bindRemoteEvent<A extends unknown[]>(
        eventDefinition: EventDefinition<A>,
        functionBinding: (...params: A) => void
    ): RBXScriptConnection {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return remoteEvent.OnClientEvent.Connect(functionBinding as (...params: unknown[]) => void);
    }

    public getRemoteEventFunction<A extends unknown[]>(eventDefinition: EventDefinition<A>): (...params: A) => void {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return ((...params: A) => remoteEvent.FireServer(...params)) as (...params: A) => void;
    }
}
