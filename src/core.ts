/**
 * The abstract base class that all tag components must extend. Tag components
 * are classes that are bound to Instances at run time that have a given tag T.
 * Tag component lifecycle is managed automatically by Crochet.
 */
export abstract class TagComponent {
    constructor(protected instance: Instance) {}

    /**
     * The method called after the tag that caused the instance to be bound
     * to the tag component is removed. This method is meant to be overriden
     * in subclasses but is not required to be implemented.
     */
    onTagRemoved(): void {}
}

/**
 * The type definition for constructors of TagComponents.
 */
type TagComponentConstructor = new (instance: Instance) => TagComponent;

/**
 * Services and controllers implementing this interface will have their onInit() method
 * called immediately after they are registered.
 */
export interface OnInit {
    onInit(): void;
}

/**
 * Services and controllers implementing this interface will have their onStart() method
 * called after start() is called on the server Crochet and after onInit() has been
 * called on all other services and controllers.
 */
export interface OnStart {
    onStart(): void;
}

/**
 * Services and Controllers implementing this interface will have their onHeartbeat()
 * method called every Heartbeat of RunService after start() is called on the server
 * Crochet.
 */
export interface OnHeartbeat {
    onHeartbeat(step: number): void;
}

/** Base function type for RemoteFunctions and BindableFunctions. */
export type UnknownFunction = (...params: never[]) => unknown;

/** Type for functions that allow typechecking for functions and events. */
export type TypeCheck<T> = (value: unknown) => value is T;

/** Type for array of type checks for the parameters of a function. */
export type ParameterChecks<F> = F extends (...args: infer P) => unknown ? { [K in keyof P]: TypeCheck<P[K]> } : never;

/** Type for a type checks for the return type of a function. */
export type ReturnCheck<F extends UnknownFunction> = TypeCheck<ReturnType<F>>;

/** Reference to the CollectionService */
const CollectionService = game.GetService('CollectionService');

/**
 * Function definitions are used to define functions that are bound to remote
 * functions and bindable functions. Function Definitions are used by the
 * Crochet to indentify functions in a type safe way.
 *
 * @example // A functions that takes a string as the first argument, a number as the
 * // second argument, and returns a boolean
 * new FunctionDefinition<[string, number], boolean>('TestFunction')
 */
export class FunctionDefinition<F extends UnknownFunction> {
    private static functionDefinitionNames = new Set<string>();

    constructor(
        public functionIdentifier: string,
        public parameterTypeguards?: ParameterChecks<F>,
        public returnTypeGuard?: ReturnCheck<F>
    ) {
        assert(
            !FunctionDefinition.functionDefinitionNames.has(functionIdentifier),
            `There is already a function defined with the identifier: ${functionIdentifier}`
        );
        FunctionDefinition.functionDefinitionNames.add(functionIdentifier);
    }
}

/**
 * Event definitions are used to define events that are bound to remote
 * events and bindable events. Event Definitions are used by the
 * Crochet to indentify events in a type safe way.
 *
 * @example // An event that returns two numbers
 * new EventDefinition<[number, number]>('TestEvent')
 */
export class EventDefinition<A extends unknown[]> {
    private static eventDefinitionNames = new Set<string>();

    constructor(
        public eventIdentifier: string,
        public parameterTypeguards?: { [K in keyof A]: (value: unknown) => value is A[K] }
    ) {
        assert(
            !EventDefinition.eventDefinitionNames.has(eventIdentifier),
            `There is already an event defined with the identifier: ${eventIdentifier}`
        );
        EventDefinition.eventDefinitionNames.add(eventIdentifier);
    }
}

type AttributeDataType =
    | string
    | boolean
    | number
    | UDim
    | UDim2
    | BrickColor
    | Color3
    | Vector2
    | Vector3
    | NumberSequence
    | ColorSequence
    | NumberRange
    | Rect;

/**
 * Attribute definitions are used to define attributes and an
 * associated type guard. Declaring attributes allows more type
 * safety when getting and saving attributes.
 *
 * @example // A string attribute called 'SecondName' using `@rbxts/t`
 * new AttributeDefinition('SecondName', t.string);
 */
export class AttributeDefinition<T extends AttributeDataType> {
    constructor(public name: string, public typeCheck?: TypeCheck<T>) {}
}

export const CROCHET_FOLDER_NAME = 'Crochet';

export abstract class CrochetCore {
    protected CrochetFolder?: Folder;
    protected FunctionFolder?: Folder;
    protected EventFolder?: Folder;

    protected functionParameterTypeGuards = new Map<string, TypeCheck<unknown>[]>();
    protected functionReturnTypeGuard = new Map<string, TypeCheck<unknown>>();

    protected eventParameterTypeGuards = new Map<string, TypeCheck<unknown>[]>();

    /**
     * Register a BindableFunction so that it can be used later.
     *
     * @param functionDefinition The FunctionDefinition to be registered
     */
    public registerBindableFunction<F extends UnknownFunction>(functionDefinition: FunctionDefinition<F>): void {
        const name = functionDefinition.functionIdentifier;
        assert(this.FunctionFolder?.FindFirstChild(name) === undefined, `Duplicate function for name ${name}!`);
        const bindableFunction = new Instance('BindableFunction');
        bindableFunction.Name = name;
        bindableFunction.Parent = this.FunctionFolder;
        if (functionDefinition.parameterTypeguards) {
            this.functionParameterTypeGuards.set(name, functionDefinition.parameterTypeguards);
        }
        if (functionDefinition.returnTypeGuard !== undefined) {
            this.functionReturnTypeGuard.set(name, functionDefinition.returnTypeGuard);
        }
    }

    /**
     * Register BindableFunctions to be used later.
     *
     * @param functionDefinition The FunctionDefinitions to be registered
     */
    public registerBindableFunctions<F extends UnknownFunction>(functionDefinitions: FunctionDefinition<F>[]): void {
        functionDefinitions.forEach((functionDefinition) => this.registerBindableFunction(functionDefinition));
    }

    /**
     * Bind a function to be called whenever a BindableFunction is invoked.
     *
     * @param functionDefinition The FunctionDefinition used to retreive and call the function
     * @param functionBinding The function to bind to the BindableFunction.
     */
    public bindBindableFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>,
        functionBinding: F
    ): void {
        const bindableFunction = this.fetchFunctionWithDefinition(functionDefinition) as BindableFunction;
        bindableFunction.OnInvoke = (...params: Parameters<F>) => {
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
     * Get a function that can be called to invoke a BindableFunction.
     *
     * @param functionDefinition The FunctionDefinition used to retreive and call the function
     * @returns A function that invokes the BindableFunction
     *
     * @example
     * Crochet.getBindableFunction(new FunctionDefinition<[string, number], boolean>('MyFunction'))('a', 1)
     */
    public getBindableFunction<F extends UnknownFunction>(
        functionDefinition: FunctionDefinition<F>
    ): (...params: Parameters<F>) => ReturnType<F> {
        const bindableFunction = this.fetchFunctionWithDefinition(functionDefinition) as BindableFunction;
        return (...params: Parameters<F>) => {
            assert(
                this.verifyFunctionParametersWithDefinition(params, functionDefinition),
                `Parameters are wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            const result = bindableFunction.Invoke(...params) as ReturnType<F>;
            assert(
                this.verifyFunctionReturnTypeWithDefinition(result, functionDefinition),
                `Return type is wrong for the function ${functionDefinition.functionIdentifier}!`
            );
            return result;
        };
    }

    protected fetchFunctionWithDefinition(
        functionDefinition: FunctionDefinition<UnknownFunction>
    ): RemoteFunction | BindableFunction {
        const name = functionDefinition.functionIdentifier;
        const func = this.FunctionFolder?.FindFirstChild(name);
        assert(func, `Could not find function with identifier ${name}!`);
        return func as RemoteFunction | BindableFunction;
    }

    protected verifyFunctionParametersWithDefinition(
        params: unknown[],
        functionDefinition: FunctionDefinition<UnknownFunction>
    ): boolean {
        const name = functionDefinition.functionIdentifier;
        const typeGuards = this.functionParameterTypeGuards.get(name);
        if (typeGuards !== undefined) {
            if (typeGuards.size() < params.size()) {
                return false;
            }
            for (let i = 0; i < typeGuards.size(); i++) {
                const guard = typeGuards[i];
                if (!guard(params[i])) {
                    return false;
                }
            }
        }
        return true;
    }

    protected verifyFunctionReturnTypeWithDefinition(
        returnResult: unknown,
        functionDefinition: FunctionDefinition<UnknownFunction>
    ): boolean {
        const name = functionDefinition.functionIdentifier;
        const typeGuard = this.functionReturnTypeGuard.get(name);
        if (typeGuard !== undefined) {
            return typeGuard(returnResult);
        }
        return true;
    }

    /**
     * Register a BindableEvent so that it can be used later.
     *
     * @param eventDefinition The EventDefinition used to retreive and call the event
     */
    public registerBindableEvent<A extends unknown[]>(eventDefinition: EventDefinition<A>): void {
        const name = eventDefinition.eventIdentifier;
        const bindableEvent = new Instance('BindableEvent');
        bindableEvent.Name = name;
        bindableEvent.Parent = this.EventFolder;
        if (eventDefinition.parameterTypeguards) {
            this.eventParameterTypeGuards.set(name, eventDefinition.parameterTypeguards);
        }
    }

    /**
     * Register BindableEvents to be used later.
     *
     * @param eventDefinition The EventDefinitions to register
     */
    public registerBindableEvents<A extends unknown[]>(eventDefinitions: EventDefinition<A>[]): void {
        eventDefinitions.forEach((eventDefinition) => this.registerBindableEvent(eventDefinition));
    }

    /**
     * Bind a function to be called whenever the BindableEvent is fired
     *
     * @param eventDefinition The EventDefinition used to retreive and call the event
     * @param functionBinding The function that is called whenever the BindableEvent is fired
     * @returns A RBXScriptConnection for the .Event connection
     */
    public bindBindableEvent<A extends unknown[]>(
        eventDefinition: EventDefinition<A>,
        functionBinding: (...params: A) => void
    ): RBXScriptConnection {
        const bindableEvent = this.fetchEventWithDefinition(eventDefinition) as BindableEvent;
        return bindableEvent.Event.Connect((...params: A) => {
            assert(
                this.verifyEventParametersWithDefinition(params, eventDefinition),
                `Parameters are wrong for the event ${eventDefinition.eventIdentifier}!`
            );
            functionBinding(...params);
        });
    }

    /**
     * Get a function that fires the BindableEvent.
     *
     * @param eventDefinition The EventDefinition used to retreive and call the event
     * @returns A function that can be invoked to fire the BindableEvent.
     *
     * @example
     * Crochet.getBindableEventFunction(new EventDefinition<[boolean]>('MyEvent'))(false);
     */
    public getBindableEventFunction<A extends unknown[]>(eventDefinition: EventDefinition<A>): (...params: A) => void {
        const bindableEvent = this.fetchEventWithDefinition(eventDefinition) as BindableEvent;
        return ((...params: A) => {
            assert(
                this.verifyEventParametersWithDefinition(params, eventDefinition),
                `Parameters are wrong for the event ${eventDefinition.eventIdentifier}!`
            );
            bindableEvent.Fire(...params);
        }) as (...params: A) => void;
    }

    /**
     * Safely returns an attribute from a Roblox instance.
     *
     * @param instance Roblox instance to get the attribute from
     * @param attribute Attribute object for the attribute to get
     */
    public getAttribute<T extends AttributeDataType>(
        instance: Instance,
        attribute: AttributeDefinition<T>
    ): T | undefined;

    /**
     * Safely returns an attribute from a Roblox instance.
     *
     * @param instance Roblox instance to get the attribute from
     * @param attribute Name of the attribute to get
     * @param typeCheck Optional TypeCheck for the resulting attribute
     */
    public getAttribute<T extends AttributeDataType>(
        instance: Instance,
        attribute: string,
        typeCheck?: TypeCheck<T>
    ): T | undefined;
    public getAttribute<T extends AttributeDataType>(
        instance: Instance,
        attribute: AttributeDefinition<T> | string,
        typeCheck?: TypeCheck<T>
    ): T | undefined {
        const attributeName = typeIs(attribute, 'string') ? attribute : (attribute as AttributeDefinition<T>).name;
        const attributeValue = instance.GetAttribute(attributeName);
        const typeCheckFunction = typeIs(attribute, 'string')
            ? typeCheck
            : (attribute as AttributeDefinition<T>).typeCheck;
        if (typeCheckFunction !== undefined) {
            if (attributeValue === undefined || typeCheckFunction(attributeValue)) {
                return attributeValue;
            } else {
                throw `Attribute ${attribute} is the wrong type: ${typeOf(attributeValue)}!`;
            }
        }

        return attributeValue as T | undefined;
    }

    /**
     * Safely sets an attribute on a Roblox instance.
     *
     * @param instance Roblox instance to set the attribute on
     * @param attribute Attribute object for the attribute to set
     * @param value Value to set the attribute propery as
     */
    public setAttribute<T extends AttributeDataType>(
        instance: Instance,
        attribute: AttributeDefinition<T>,
        value: T | undefined
    ): void;

    /**
     * Safely sets an attribute on a Roblox instance.
     *
     * @param instance Roblox instance to set the attribute on
     * @param attribute Name of the attribute to set
     * @param value Value to set the attribute propery as
     * @param typeCheck Optional TypeCheck for the attribute
     */
    public setAttribute<T extends AttributeDataType>(
        instance: Instance,
        attribute: string,
        value: T | undefined,
        typeCheck?: TypeCheck<T>
    ): void;
    public setAttribute<T extends AttributeDataType>(
        instance: Instance,
        attribute: AttributeDefinition<T> | string,
        value: T | undefined,
        typeCheck?: TypeCheck<T>
    ): void {
        const attributeName = typeIs(attribute, 'string') ? attribute : (attribute as AttributeDefinition<T>).name;
        const typeCheckFunction = typeIs(attribute, 'string')
            ? typeCheck
            : (attribute as AttributeDefinition<T>).typeCheck;
        if (typeCheckFunction !== undefined && value !== undefined && !typeCheckFunction(value)) {
            throw `Attribute ${attribute} is the wrong type: ${typeOf(value)}!`;
        }

        instance.SetAttribute(attributeName, value);
    }

    protected fetchEventWithDefinition(eventDefinition: EventDefinition<unknown[]>): RemoteEvent | BindableEvent {
        const name = eventDefinition.eventIdentifier;
        const event = this.EventFolder?.FindFirstChild(name);
        assert(event, `Could not find event with identifier ${name}!`);
        return event as RemoteEvent | BindableEvent;
    }

    protected verifyEventParametersWithDefinition(
        params: unknown[],
        eventDefinition: EventDefinition<unknown[]>
    ): boolean {
        const name = eventDefinition.eventIdentifier;
        const typeGuards = this.eventParameterTypeGuards.get(name);
        if (typeGuards !== undefined) {
            if (typeGuards.size() < params.size()) {
                return false;
            }
            for (let i = 0; i < typeGuards.size(); i++) {
                const guard = typeGuards[i];
                if (!guard(params[i])) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Register a tag component. Tag components will be added to all instances with a
     * given tag when registered and will be added to any instances to recieve that tag
     * after being registered. After a tag is removed from an instance, the tag component's
     * onTagRemoved method will be called.
     *
     * @param tagComponentConstructor The constructor of the Component being registered
     * @param tag The tag to find instances to bind the component to
     *
     * @example CrochetServer.registerService(MyService);
     */
    public registerTagComponentForTag(tagComponentConstructor: TagComponentConstructor, tag: string): void {
        const tagComponents = new Map<Instance, TagComponent>();
        const bindToInstance = (instance: Instance) => {
            const tagComponent = new tagComponentConstructor(instance);
            tagComponents.set(instance, tagComponent);
        };

        CollectionService.GetInstanceAddedSignal(tag).Connect(bindToInstance);
        CollectionService.GetTagged(tag).forEach(bindToInstance);
        CollectionService.GetInstanceRemovedSignal(tag).Connect((instance) => {
            const tagComponent = tagComponents.get(instance);
            if (tagComponent !== undefined) {
                tagComponent.onTagRemoved();
                tagComponents.delete(instance);
            }
        });
    }

    /**
     * Register mulitple tag components at once.
     *
     * @param tagComponentConstructors The constuctors of multiple tag components being registered
     */
    public registerTagComponents(tagComponentBindings: [TagComponentConstructor, string][]): void {
        tagComponentBindings.forEach((tagComponentBinding) => this.registerTagComponentForTag(...tagComponentBinding));
    }
}
