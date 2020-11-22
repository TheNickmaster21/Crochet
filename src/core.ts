/** Services and controllers implementing this interface will have their onInit() method
 *  called immediately after they are registered.
 */
export interface OnInit {
    onInit(): void;
}

/** Services and controllers implementing this interface will have their onStart() method
 *  called after start() is called on the server Crochet and after onInit() has been
 *  called on all other services and controllers.
 */
export interface OnStart {
    onStart(): void;
}

/** Services and Controllers implementing this interface will have their onHeartbeat()
 * method called every Heartbeat of RunService after start() is called on the server
 * Crochet.
 */
export interface OnHeartbeat {
    onHeartbeat(step: number): void;
}

/** Type for functions that allow typechecking for functions and events. */
export type TypeCheck<T> = (value: unknown) => value is T;

/** Base function type for RemoteFunctions and BindableFunctions. */
export type UnknownFunction = (...params: never[]) => unknown;

/** Function definitions are used to define functions that are bound to remote
 * functions and bindable functions. Function Definitions are used by the
 * Crochet to indentify functions in a type safe way.
 *
 * ex. A functions that takes a string as the first argument, a number as the
 *     second argument, and returns a boolean
 * new FunctionDefinition<[string, number], boolean>('TestFunction')
 */
export class FunctionDefinition<F extends UnknownFunction> {
    private static functionDefinitionNames = new Set<string>();

    constructor(
        public functionIdentifier: string
    ) // public parameterTypeGaurds?: { [K in keyof Parameters<F>]: (value: unknown) => value is Parameters<F>[K] },
    // public returnTypeGuard?: TypeCheck<ReturnType<F>>
    {
        assert(
            !FunctionDefinition.functionDefinitionNames.has(functionIdentifier),
            `There is already a function defined with the identifier: ${functionIdentifier}`
        );
        FunctionDefinition.functionDefinitionNames.add(functionIdentifier);
    }
}

/** Event definitions are used to define events that are bound to remote
 * events and bindable events. Event Definitions are used by the
 * Crochet to indentify events in a type safe way.
 *
 * ex. An event that returns two numbers
 * new EventDefinition<[number, number]>('TestEvent')
 */
export class EventDefinition<A extends unknown[]> {
    private static eventDefinitionNames = new Set<string>();

    constructor(
        public eventIdentifier: string
    ) // public parameterTypeGaurds?: { [K in keyof A]: (value: unknown) => value is A[K] }
    {
        assert(
            !EventDefinition.eventDefinitionNames.has(eventIdentifier),
            `There is already an event defined with the identifier: ${eventIdentifier}`
        );
        EventDefinition.eventDefinitionNames.add(eventIdentifier);
    }
}

export const CROCHET_FOLDER_NAME = 'Crochet';

export abstract class CrochetCore {
    protected CrochetFolder?: Folder;
    protected functionFolder?: Folder;
    protected eventFolder?: Folder;

    public registerBindableFunction<F extends UnknownFunction>(functionDefinition: FunctionDefinition<F>): void {
        const name = functionDefinition.functionIdentifier;
        assert(this.functionFolder?.FindFirstChild(name) === undefined, `Duplicate function for name ${name}!`);
        const bindableFunction = new Instance('BindableFunction');
        bindableFunction.Name = name;
        bindableFunction.Parent = this.functionFolder;
    }

    public bindBindableFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>,
        functionBinding: F
    ): void {
        const bindableFunction = this.fetchFunctionWithDefinition(functionDefinition) as BindableFunction;
        bindableFunction.OnInvoke = functionBinding as F;
    }

    public getBindableFunction<F extends UnknownFunction>(functionDefinition: FunctionDefinition<F>): F {
        const bindableFunction = this.fetchFunctionWithDefinition(functionDefinition) as BindableFunction;
        return ((...params: Parameters<F>) => bindableFunction.Invoke(...params)) as F;
    }

    protected fetchFunctionWithDefinition(
        functionDefinition: FunctionDefinition<UnknownFunction>
    ): RemoteFunction | BindableFunction {
        const name = functionDefinition.functionIdentifier;
        const func = this.functionFolder?.FindFirstChild(name);
        assert(func !== undefined, `Could not find function with identifier ${name}!`);
        return func as RemoteFunction | BindableFunction;
    }

    public registerBindableEvent<A extends unknown[]>(eventDefinition: EventDefinition<A>): void {
        const name = eventDefinition.eventIdentifier;
        const bindableEvent = new Instance('BindableEvent');
        bindableEvent.Name = name;
        bindableEvent.Parent = this.eventFolder;
    }

    public bindBindableEvent<A extends unknown[]>(
        eventDefinition: EventDefinition<A>,
        functionBinding: (...params: A) => void
    ): RBXScriptConnection {
        const bindableEvent = this.fetchEventWithDefinition(eventDefinition) as BindableEvent;
        return bindableEvent.Event.Connect(functionBinding);
    }

    public getBindableEventFunction<A extends unknown[]>(eventDefinition: EventDefinition<A>): (...params: A) => void {
        const bindableEvent = this.fetchEventWithDefinition(eventDefinition) as BindableEvent;
        return ((...params: A) => bindableEvent.Fire(...params)) as (...params: A) => void;
    }

    protected fetchEventWithDefinition(eventDefinition: EventDefinition<unknown[]>): RemoteEvent | BindableEvent {
        const name = eventDefinition.eventIdentifier;
        const event = this.eventFolder?.FindFirstChild(name);
        assert(event !== undefined, `Could not find event with identifier ${name}!`);
        return event as RemoteEvent | BindableEvent;
    }
}
