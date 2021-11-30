import {
    CROCHET_FOLDER_NAME,
    CrochetCore,
    EventDefinition,
    FunctionDefinition,
    OnHeartbeat,
    OnInit,
    OnStart,
    UnknownFunction
} from 'core';

import Object from '@rbxts/object-utils';

/**
 * The abstract base class that all controllers must extend. Controllers are
 * singletons that are created on the client to manage behaviors not tied to
 * single instances.
 */
export abstract class Controller {}

/**
 * The type definition for constructors of Controllers.
 */
type ControllerConstructor = new () => Controller;

/**
 * CrochetServerImplementation is the Crochet class for use in Server Scripts.
 */
export class CrochetClientImplementation extends CrochetCore {
    private controllers = new Map<string, Controller>();

    private startPromise?: Promise<void>;

    public constructor() {
        super();

        this.CrochetFolder = script.Parent?.WaitForChild(CROCHET_FOLDER_NAME) as Folder;
        this.FunctionFolder = this.CrochetFolder.WaitForChild('Functions') as Folder;
        this.EventFolder = this.CrochetFolder.WaitForChild('Events') as Folder;
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
                Promise.defer(() => {
                    script.Parent?.WaitForChild('Started');
                    Object.values(this.controllers).forEach((controller) => {
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
     *  Register a controller. Once a controller is registered, it's onInit method will be called (if one
     *  exists). Once controllers are registered, they can be retreived on the server by calling getController().
     *
     * @param controllerConstructor  The constructor of the Controller being registered
     * @throws Controllers can only be registered before start() has been called
     * @throws Controllers can only be registered once
     *
     * @example CrochetClient.registerController(MyController);
     F*/
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
     * Retreive the controller for a given Controller class.
     *
     * @param controllerConstructor
     * @return A singleton implementation of the give controllerConstructor
     * @throws The given controllerConstructor must have been registered before this method is called!
     *
     * @example CrochetClient.getController(MyController); // Returns MyController instance
     */
    public getController<S extends ControllerConstructor>(controllerConstructor: S): InstanceType<S> {
        const controllerKey = tostring(controllerConstructor);
        assert(this.controllers.has(controllerKey), `No controller registered for name ${controllerKey}!`);
        return this.controllers.get(controllerKey) as InstanceType<S>;
    }

    /**
     * Get a function that can be called on the client to invoke a RemoteEvent. Unlike getServerSideRemotePromiseFunction,
     * this method returns a function that yields the current thread until the function returns.
     *
     * @param functionDefinition The FunctionDefinition used to retreive and call the function
     * @returns A function that invokes the RemoteFunction
     */
    public getServerSideRemoteFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>
    ): (...params: Parameters<F>) => ReturnType<F> {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        return (...params: Parameters<F>) => {
            assert(
                this.verifyFunctionParametersWithDefinition(params, functionDefinition),
                `Parameters are wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            const result = remoteFunction.InvokeServer(...params) as ReturnType<F>;
            assert(
                this.verifyFunctionReturnTypeWithDefinition(result, functionDefinition),
                `Return type is wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            return result;
        };
    }

    /**
     * Get a function that can be called on the server to invoke a RemoteFunction. Unlike getServerSideRemoteFunction,
     * this method returns a function that returns a Promise.
     *
     * @param functionDefinition The FunctionDefinition used to retreive and call the function
     * @returns A function that invokes the RemoteFunction
     */
    public getServerSideRemotePromiseFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>
    ): (...params: Parameters<F>) => Promise<ReturnType<F>> {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        return (...params: unknown[]) => {
            assert(
                this.verifyFunctionParametersWithDefinition(params, functionDefinition),
                `Parameters are wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            return new Promise((resolve) =>
                Promise.defer(() => {
                    const result = remoteFunction.InvokeServer(...params) as ReturnType<F>;
                    assert(
                        this.verifyFunctionReturnTypeWithDefinition(result, functionDefinition),
                        `Return type is wrong for the function ${functionDefinition.functionIdentifier}!`
                    );
                    resolve(result);
                })
            );
        };
    }

    /**
     * @deprecated Client Side RemoteFunctions are unsafe. (See https://developer.roblox.com/en-us/articles/Remote-Functions-and-Events#remote-function-warning)
     *
     * Bind a function to be called whenever a RemoteFunction is invoked by the server.
     *
     * @param functionDefinition The FunctionDefinition used to retreive and call the function
     * @param functionBinding The function to bind to the RemoteFunction.
     */
    public bindClientSideRemoteFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>,
        functionBinding: F
    ): void {
        const remoteFunction = this.fetchFunctionWithDefinition(functionDefinition) as RemoteFunction;
        remoteFunction.OnClientInvoke = (...params: Parameters<F>) => {
            assert(
                this.verifyFunctionParametersWithDefinition(params, functionDefinition),
                `Parameters are wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            const result = functionBinding(...params) as ReturnType<F>;
            assert(
                this.verifyFunctionReturnTypeWithDefinition(result, functionDefinition),
                `Return type is wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            return result;
        };
    }

    /**
     * Bind a function to be called whenever the BindableEvent is fired by the server.
     *
     * @param eventDefinition The EventDefinition used to retreive and call the event
     * @param functionBinding The function that is called whenever the RemoteEvent is fired
     * @returns A RBXScriptConnection for the .Event connection
     */
    public bindRemoteEvent<A extends unknown[]>(
        eventDefinition: EventDefinition<A>,
        functionBinding: (...params: A) => void
    ): RBXScriptConnection {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return remoteEvent.OnClientEvent.Connect((...params: A) => {
            assert(
                this.verifyEventParametersWithDefinition(params, eventDefinition),
                `Parameters are wrong for the event ${eventDefinition.eventIdentifier}!`
            );
            functionBinding(...params);
        });
    }

    /**
     * Get a function that fires the RemoteEvent for the server.
     *
     * @param eventDefinition The EventDefinition used to retreive and call the event
     * @returns A function that can be invoked to fire the RemoteEvent.
     *
     * @example Crochet.getRemoteEventFunction(new EventDefinition<[boolean]>('MyEvent'))(false);
     */
    public getRemoteEventFunction<A extends unknown[]>(eventDefinition: EventDefinition<A>): (...params: A) => void {
        const remoteEvent = this.fetchEventWithDefinition(eventDefinition) as RemoteEvent;
        return ((...params: A) => {
            assert(
                this.verifyEventParametersWithDefinition(params, eventDefinition),
                `Parameters are wrong for the event ${eventDefinition.eventIdentifier}!`
            );
            remoteEvent.FireServer(...params);
        }) as (...params: A) => void;
    }
}
