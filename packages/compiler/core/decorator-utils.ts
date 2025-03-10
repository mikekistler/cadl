import { getPropertyType } from "../lib/decorators.js";
import { getTypeName } from "./helpers/type-name-utils.js";
import { compilerAssert, Interface, Model, SyntaxKind } from "./index.js";
import { createDiagnostic, reportDiagnostic } from "./messages.js";
import { Program } from "./program.js";
import {
  DecoratorContext,
  DecoratorFunction,
  Diagnostic,
  DiagnosticTarget,
  IntrinsicScalarName,
  ModelProperty,
  Scalar,
  Type,
} from "./types.js";

/** @deprecated Use TypeSpecValue */
export type CadlValue = TypeSpecValue;

export type TypeSpecValue = Type | string | number | boolean;

/** @deprecated Use InferredTypeSpecValue */
export type InferredCadlValue<K extends TypeKind> = InferredTypeSpecValue<K>;

// prettier-ignore
export type InferredTypeSpecValue<K extends TypeKind> = 
  K extends "Any" ? TypeSpecValue
  : K extends (infer T extends Type["kind"])[] ? InferredTypeSpecValue<T>
  : K extends "String" ? string 
  : K extends "Number" ? number 
  : K extends "Boolean" ? boolean 
  : Type & { kind: K };

/**
 * Validate the decorator target is matching the expected value.
 * @param program
 * @param target
 * @param expectedType
 * @param decoratorName
 * @returns
 */
export function validateDecoratorTarget<K extends TypeKind>(
  context: DecoratorContext,
  target: Type,
  decoratorName: string,
  expectedType: K | readonly K[]
): target is K extends "Any" ? Type : Type & { kind: K } {
  const isCorrectType = isTypeSpecValueTypeOf(target, expectedType);
  if (!isCorrectType) {
    reportDiagnostic(context.program, {
      code: "decorator-wrong-target",
      format: {
        decorator: decoratorName,
        to: target.kind,
      },
      target: context.decoratorTarget,
    });
    return false;
  }

  return true;
}

export function validateDecoratorTargetIntrinsic(
  context: DecoratorContext,
  target: Scalar | ModelProperty,
  decoratorName: string,
  expectedType: IntrinsicScalarName | IntrinsicScalarName[]
): boolean {
  const expectedTypeStrs = typeof expectedType === "string" ? [expectedType] : expectedType;
  const expectedTypes = expectedTypeStrs.map((x) => context.program.checker.getStdType(x));
  const type = getPropertyType(target);
  const isCorrect = expectedTypes.some(
    (x) => context.program.checker.isTypeAssignableTo(type.projectionBase ?? type, x, type)[0]
  );
  if (!isCorrect) {
    context.program.reportDiagnostic(
      createDiagnostic({
        code: "decorator-wrong-target",
        format: {
          decorator: decoratorName,
          to: `type it is not one of: ${typeof expectedTypeStrs.join(", ")}`,
        },
        target: context.decoratorTarget,
      })
    );
    return false;
  }
  return true;
}

/** @deprecated use isTypeSpecValueTypeOf */
export const isCadlValueTypeOf = isTypeSpecValueTypeOf;

/**
 * Check if the given target is of any of the typespec types.
 * @param target Target to validate.
 * @param expectedType One or multiple allowed typespec types.
 * @returns boolean if the target is of one of the allowed types.
 */
export function isTypeSpecValueTypeOf<K extends TypeKind>(
  target: TypeSpecValue,
  expectedType: K | readonly K[]
): target is InferredTypeSpecValue<K> {
  const kind = getTypeKind(target);
  if (kind === undefined) {
    return false;
  }

  return typeof expectedType === "string"
    ? expectedType === "Any" || kind === expectedType
    : expectedType.includes("Any" as any) || expectedType.includes(kind as any);
}

function getTypeKind(target: TypeSpecValue): Type["kind"] | undefined {
  switch (typeof target) {
    case "object":
      return target.kind;
    case "string":
      return "String";
    case "number":
      return "Number";
    case "boolean":
      return "Boolean";
    default:
      return undefined;
  }
}

/**
 * Validate a decorator parameter has the correct type.
 * @param program Program
 * @param target Decorator target
 * @param value Value of the parameter.
 * @param expectedType Expected type or list of expected type
 * @returns true if the value is of one of the type in the list of expected types. If not emit a diagnostic.
 * @deprecated use @see createDecoratorDefinition#validate instead.
 */
export function validateDecoratorParamType<K extends Type["kind"]>(
  program: Program,
  target: Type,
  value: TypeSpecValue,
  expectedType: K | K[]
): value is InferredTypeSpecValue<K> {
  if (!isTypeSpecValueTypeOf(value, expectedType)) {
    reportDiagnostic(program, {
      code: "invalid-argument",
      format: {
        value: prettyValue(program, value),
        expected: typeof expectedType === "string" ? expectedType : expectedType.join(", "),
      },
      target,
    });
    return false;
  }
  return true;
}

export interface DecoratorDefinition<
  T extends TypeKind,
  P extends readonly DecoratorParamDefinition<TypeKind>[],
  S extends DecoratorParamDefinition<TypeKind> | undefined = undefined
> {
  /**
   * Name of the decorator.
   */
  readonly name: string;

  /**
   * Decorator target.
   */
  readonly target: T | readonly T[];

  /**
   * List of positional arguments in the function.
   */
  readonly args: P;

  /**
   * @optional Type of the spread args at the end of the function if applicable.
   */
  readonly spreadArgs?: S;
}

export interface DecoratorParamDefinition<K extends TypeKind> {
  /**
   * Kind of the parameter
   */
  readonly kind: K | readonly K[];

  /**
   * Is the parameter optional.
   */
  readonly optional?: boolean;
}

type InferParameters<
  P extends readonly DecoratorParamDefinition<TypeKind>[],
  S extends DecoratorParamDefinition<TypeKind> | undefined
> = S extends undefined
  ? InferPosParameters<P>
  : [...InferPosParameters<P>, ...InferSpreadParameter<S>];

type InferSpreadParameter<S extends DecoratorParamDefinition<TypeKind> | undefined> =
  S extends DecoratorParamDefinition<Type["kind"]> ? InferParameter<S>[] : never;

type InferPosParameters<P extends readonly DecoratorParamDefinition<TypeKind>[]> = {
  [K in keyof P]: InferParameter<P[K]>;
};

type InferParameter<P extends DecoratorParamDefinition<TypeKind>> = P["optional"] extends true
  ? InferParameterKind<P["kind"]> | undefined
  : InferParameterKind<P["kind"]>;

// prettier-ignore
type InferParameterKind<P extends TypeKind | readonly TypeKind[]> =
  P extends readonly (infer T extends TypeKind)[] ? InferredTypeSpecValue<T> 
  : P extends TypeKind ? InferredTypeSpecValue<P> : never

export interface DecoratorValidator<
  T extends TypeKind,
  P extends readonly DecoratorParamDefinition<TypeKind>[],
  S extends DecoratorParamDefinition<TypeKind> | undefined = undefined
> {
  validate(
    context: DecoratorContext,
    target: InferredTypeSpecValue<T>,
    parameters: InferParameters<P, S>
  ): boolean;
}

export type TypeKind = Type["kind"] | "Any";

/**
 * @deprecated use extern dec definition in typespec instead.
 */
export function createDecoratorDefinition<
  T extends TypeKind,
  P extends readonly DecoratorParamDefinition<TypeKind>[],
  S extends DecoratorParamDefinition<TypeKind> | undefined
>(definition: DecoratorDefinition<T, P, S>): DecoratorValidator<T, P, S> {
  const minParams = definition.args.filter((x) => !x.optional).length;
  const maxParams = definition.spreadArgs ? undefined : definition.args.length;

  function validate(context: DecoratorContext, target: Type, args: TypeSpecValue[]) {
    if (
      !validateDecoratorTarget(context, target, definition.name, definition.target) ||
      !validateDecoratorParamCount(context, minParams, maxParams, args)
    ) {
      return false;
    }

    for (const [index, arg] of args.entries()) {
      const paramDefinition = definition.args[index] ?? definition.spreadArgs;
      if (arg === undefined) {
        if (!paramDefinition.optional) {
          reportDiagnostic(context.program, {
            code: "invalid-argument",
            format: {
              value: "undefined",
              expected: expectedTypeList(paramDefinition.kind as any),
            },
            target: context.getArgumentTarget(index)!,
          });
          return false;
        }
      } else if (!isTypeSpecValueTypeOf(arg, paramDefinition.kind)) {
        reportDiagnostic(context.program, {
          code: "invalid-argument",
          format: {
            value: prettyValue(context.program, arg),
            expected: expectedTypeList(paramDefinition.kind as any),
          },
          target: context.getArgumentTarget(index)!,
        });
        return false;
      }
    }

    return true;
  }

  return {
    validate(context: DecoratorContext, target, parameters) {
      return validate(context, target as any, parameters as any);
    },
  };
}

function expectedTypeList(expectedType: Type["kind"] | Type["kind"][]) {
  return typeof expectedType === "string" ? expectedType : expectedType.join(", ");
}

export function validateDecoratorParamCount(
  context: DecoratorContext,
  min: number,
  max: number | undefined,
  parameters: unknown[]
): boolean {
  let missing = 0;
  for (let i = parameters.length - 1; i >= 0; i--) {
    if (parameters[i] === undefined) {
      missing++;
    } else {
      break;
    }
  }
  const parameterCount = parameters.length - missing;
  if (parameterCount < min || (max !== undefined && parameterCount > max)) {
    if (min === max) {
      reportDiagnostic(context.program, {
        code: "invalid-argument-count",
        format: {
          actual: parameterCount.toString(),
          expected: min.toString(),
        },
        target: context.decoratorTarget,
      });
    } else {
      reportDiagnostic(context.program, {
        code: "invalid-argument-count",
        format: {
          actual: parameterCount.toString(),
          expected: `${min}-${max === undefined ? "infinity" : max.toString()}`,
        },
        target: context.decoratorTarget,
      });
    }
    return false;
  }
  return true;
}

function prettyValue(program: Program, value: any) {
  if (typeof value === "object" && value !== null && "kind" in value) {
    return getTypeName(value);
  }
  return value;
}

/** @deprecated use typespecTypeToJson */
export const cadlTypeToJson = typespecTypeToJson;

/**
 * Convert a typespec type to a serializable Json object.
 * Emits diagnostics if the given type is invalid
 * @param typespecType The type to convert to Json data
 * @param target The diagnostic target in case of errors.
 */
export function typespecTypeToJson<T>(
  typespecType: TypeSpecValue,
  target: DiagnosticTarget
): [T | undefined, Diagnostic[]] {
  if (typeof typespecType !== "object") {
    return [typespecType as any, []];
  }
  return typespecTypeToJsonInternal(typespecType, target, []);
}

function typespecTypeToJsonInternal(
  typespecType: Type,
  target: DiagnosticTarget,
  path: string[]
): [any | undefined, Diagnostic[]] {
  switch (typespecType.kind) {
    case "String":
    case "Boolean":
    case "Number":
      return [typespecType.value, []];
    case "EnumMember":
      return [typespecType.value ?? typespecType.name, []];
    case "Tuple": {
      const result = [];
      for (const [index, type] of typespecType.values.entries()) {
        const [item, diagnostics] = typespecTypeToJsonInternal(type, target, [
          ...path,
          index.toString(),
        ]);
        if (diagnostics.length > 0) {
          return [undefined, diagnostics];
        }
        result.push(item);
      }
      return [result, []];
    }
    case "Model": {
      const result: Record<string, any> = {};
      for (const [name, type] of typespecType.properties.entries()) {
        const [item, diagnostics] = typespecTypeToJsonInternal(type.type, target, [
          ...path,
          name.toString(),
        ]);
        if (diagnostics.length > 0) {
          return [undefined, diagnostics];
        }
        result[name] = item;
      }
      return [result, []];
    }
    default:
      const diagnostic =
        path.length === 0
          ? createDiagnostic({
              code: "invalid-value",
              format: {
                kind: typespecType.kind,
              },
              target,
            })
          : createDiagnostic({
              code: "invalid-value",
              messageId: "atPath",
              format: {
                kind: typespecType.kind,
                path: path.join("."),
              },
              target,
            });
      return [undefined, [diagnostic]];
  }
}

export function validateDecoratorUniqueOnNode(
  context: DecoratorContext,
  type: Type,
  decorator: DecoratorFunction
) {
  compilerAssert("decorators" in type, "Type should have decorators");

  const sameDecorators = type.decorators.filter(
    (x) =>
      x.decorator === decorator &&
      x.node?.kind === SyntaxKind.DecoratorExpression &&
      x.node?.parent === type.node
  );

  if (sameDecorators.length > 1) {
    reportDiagnostic(context.program, {
      code: "duplicate-decorator",
      format: { decoratorName: "@" + decorator.name.slice(1) },
      target: context.decoratorTarget,
    });
    return false;
  }
  return true;
}

/**
 * Validate that a given decorator is not on a type or any of its base types.
 * Useful to check for decorator usage that conflicts with another decorator.
 * @param context Decorator context
 * @param type The type to check
 * @param badDecorator The decorator we don't want present
 * @param givenDecorator The decorator that is the reason why we don't want the bad decorator present
 * @param includeHeritage Whether to check base types for the bad decorator too
 * @returns Whether the decorator application is valid
 */
export function validateDecoratorNotOnType(
  context: DecoratorContext,
  type: Type,
  badDecorator: DecoratorFunction,
  givenDecorator: DecoratorFunction
) {
  compilerAssert("decorators" in type, "Type should have decorators");
  const decAppsToCheck = [];

  let base: Type | undefined = type;
  while (base) {
    decAppsToCheck.push(...(base as Interface | Model).decorators);
    base = getHeritage(base);
  }

  for (const decapp of decAppsToCheck) {
    if (decapp.decorator === badDecorator) {
      reportDiagnostic(context.program, {
        code: "decorator-conflict",
        format: {
          decoratorName: "@" + badDecorator.name.slice(1),
          otherDecoratorName: "@" + givenDecorator.name.slice(1),
        },
        target: context.decoratorTarget,
      });
      return false;
    }
  }

  return true;

  function getHeritage(type: Type): Type | undefined {
    if (type.kind === "Model") {
      return type.baseModel;
    } else if (type.kind === "Scalar") {
      return type.baseScalar;
    } else {
      return undefined;
    }
  }
}
