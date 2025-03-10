import {
  DecoratorContext,
  DiagnosticTarget,
  Enum,
  EnumMember,
  getNamespaceFullName,
  ModelProperty,
  Namespace,
  ObjectType,
  Operation,
  Program,
  ProjectionApplication,
  Type,
} from "@typespec/compiler";
import { createStateSymbol, reportDiagnostic } from "./lib.js";

const addedOnKey = createStateSymbol("addedOn");
const removedOnKey = createStateSymbol("removedOn");
const versionsKey = createStateSymbol("versions");
const versionDependencyKey = createStateSymbol("versionDependency");
const useDependencyNamespaceKey = createStateSymbol("useDependencyNamespace");
const useDependencyEnumKey = createStateSymbol("useDependencyEnum");
const renamedFromKey = createStateSymbol("renamedFrom");
const madeOptionalKey = createStateSymbol("madeOptional");
const typeChangedFromKey = createStateSymbol("typeChangedFrom");
const returnTypeChangedFromKey = createStateSymbol("returnTypeChangedFrom");

export const namespace = "TypeSpec.Versioning";

function checkIsVersion(
  program: Program,
  enumMember: EnumMember,
  diagnosticTarget: DiagnosticTarget
): Version | undefined {
  const version = getVersionForEnumMember(program, enumMember);
  if (!version) {
    reportDiagnostic(program, {
      code: "version-not-found",
      target: diagnosticTarget,
      format: { version: enumMember.name, enumName: enumMember.enum.name },
    });
  }
  return version;
}

export function $added(context: DecoratorContext, t: Type, v: EnumMember) {
  const { program } = context;

  const version = checkIsVersion(context.program, v, context.getArgumentTarget(0)!);
  if (!version) {
    return;
  }

  // retrieve statemap to update or create a new one
  const record = program.stateMap(addedOnKey).get(t) ?? new Array<Version>();
  record.push(version);
  // ensure that records are stored in ascending order
  (record as Version[]).sort((a, b) => a.index - b.index);

  program.stateMap(addedOnKey).set(t, record);
}

export function $removed(context: DecoratorContext, t: Type, v: EnumMember) {
  const { program } = context;

  const version = checkIsVersion(context.program, v, context.getArgumentTarget(0)!);
  if (!version) {
    return;
  }

  // retrieve statemap to update or create a new one
  const record = program.stateMap(removedOnKey).get(t) ?? new Array<Version>();
  record.push(version);
  // ensure that records are stored in ascending order
  (record as Version[]).sort((a, b) => a.index - b.index);

  program.stateMap(removedOnKey).set(t, record);
}

/**
 * Returns the mapping of versions to old type values, if applicable
 * @param p TypeSpec program
 * @param t type to query
 * @returns Map of versions to old types, if any
 */
export function getTypeChangedFrom(p: Program, t: Type): Map<Version, Type> | undefined {
  return p.stateMap(typeChangedFromKey).get(t) as Map<Version, Type>;
}

export function $typeChangedFrom(
  context: DecoratorContext,
  prop: ModelProperty,
  v: EnumMember,
  oldType: any
) {
  const { program } = context;

  const version = checkIsVersion(context.program, v, context.getArgumentTarget(0)!);
  if (!version) {
    return;
  }

  // retrieve statemap to update or create a new one
  let record = getTypeChangedFrom(program, prop) ?? new Map<Version, any>();
  record.set(version, oldType);
  // ensure the map is sorted by version
  record = new Map([...record.entries()].sort((a, b) => a[0].index - b[0].index));
  program.stateMap(typeChangedFromKey).set(prop, record);
}

/**
 * Returns the mapping of versions to old return type values, if applicable
 * @param p TypeSpec program
 * @param t type to query
 * @returns Map of versions to old types, if any
 */
export function getReturnTypeChangedFrom(p: Program, t: Type): Map<Version, Type> | undefined {
  return p.stateMap(returnTypeChangedFromKey).get(t) as Map<Version, Type>;
}

export function $returnTypeChangedFrom(
  context: DecoratorContext,
  op: Operation,
  v: EnumMember,
  oldReturnType: any
) {
  const { program } = context;

  const version = checkIsVersion(context.program, v, context.getArgumentTarget(0)!);
  if (!version) {
    return;
  }

  // retrieve statemap to update or create a new one
  let record = getReturnTypeChangedFrom(program, op) ?? new Map<Version, any>();
  record.set(version, oldReturnType);
  // ensure the map is sorted by version
  record = new Map([...record.entries()].sort((a, b) => a[0].index - b[0].index));
  program.stateMap(returnTypeChangedFromKey).set(op, record);
}

interface RenamedFrom {
  version: Version;
  oldName: string;
}

export function $renamedFrom(context: DecoratorContext, t: Type, v: EnumMember, oldName: string) {
  const { program } = context;
  const version = checkIsVersion(context.program, v, context.getArgumentTarget(0)!);
  if (!version) {
    return;
  }

  if (oldName === "") {
    reportDiagnostic(program, {
      code: "invalid-renamed-from-value",
      target: t,
    });
  }

  // retrieve statemap to update or create a new one
  const record = getRenamedFrom(program, t) ?? [];
  record.push({ version: version, oldName: oldName });
  // ensure that records are stored in ascending order
  record.sort((a, b) => a.version.index - b.version.index);

  program.stateMap(renamedFromKey).set(t, record);
}

export function $madeOptional(context: DecoratorContext, t: ModelProperty, v: EnumMember) {
  const { program } = context;
  const version = checkIsVersion(context.program, v, context.getArgumentTarget(0)!);
  if (!version) {
    return;
  }
  program.stateMap(madeOptionalKey).set(t, version);
}

function toVersion(p: Program, t: Type, v: ObjectType): Version | undefined {
  const [namespace] = getVersions(p, t);
  if (namespace === undefined) {
    return undefined;
  }
  return getVersionForNamespace(
    p,
    v,
    (namespace.projectionBase as Namespace) ?? namespace
  ) as Version;
}

function getRenamedFrom(p: Program, t: Type): Array<RenamedFrom> | undefined {
  return p.stateMap(renamedFromKey).get(t) as Array<RenamedFrom>;
}

/**
 * @returns the list of versions for which this decorator has been applied
 */
export function getRenamedFromVersions(p: Program, t: Type): Version[] | undefined {
  return getRenamedFrom(p, t)?.map((x) => x.version);
}

/**
 * @returns get old name if applicable.
 */
export function getNameAtVersion(p: Program, t: Type, v: ObjectType): string {
  const version = toVersion(p, t, v);
  const allValues = getRenamedFrom(p, t);
  if (!allValues || !version) return "";

  const targetIndex = version.index;

  for (const val of allValues) {
    const index = val.version.index;
    if (targetIndex < index) {
      return val.oldName;
    }
  }
  return "";
}

/**
 * @returns get old type if applicable.
 */
export function getTypeBeforeVersion(p: Program, t: Type, v: ObjectType): Type | undefined {
  const target = toVersion(p, t, v);
  const map = getTypeChangedFrom(p, t);
  if (!map || !target) return undefined;

  for (const [key, val] of map) {
    if (target.index < key.index) {
      return val;
    }
  }
  return undefined;
}

/**
 * @returns get old type if applicable.
 */
export function getReturnTypeBeforeVersion(p: Program, t: Type, v: ObjectType): any {
  const target = toVersion(p, t, v);
  const map = getReturnTypeChangedFrom(p, t);
  if (!map || !target) return "";

  for (const [key, val] of map) {
    if (target.index < key.index) {
      return val;
    }
  }
  return "";
}

export function getAddedOnVersions(p: Program, t: Type): Version[] | undefined {
  return p.stateMap(addedOnKey).get(t) as Version[];
}

export function getRemovedOnVersions(p: Program, t: Type): Version[] | undefined {
  return p.stateMap(removedOnKey).get(t) as Version[];
}

/**
 * @returns version when the given type was made optional if applicable.
 */
export function getMadeOptionalOn(p: Program, t: Type): Version | undefined {
  return p.stateMap(madeOptionalKey).get(t);
}

export class VersionMap {
  private map = new Map<EnumMember, Version>();

  constructor(namespace: Namespace, enumType: Enum) {
    let index = 0;
    for (const member of enumType.members.values()) {
      this.map.set(member, {
        name: member.name,
        value: member.value?.toString() ?? member.name,
        enumMember: member,
        index,
        namespace,
      });
      index++;
    }
  }

  public getVersionForEnumMember(member: EnumMember): Version | undefined {
    return this.map.get(member);
  }

  public getVersions(): Version[] {
    return [...this.map.values()];
  }

  public get size(): number {
    return this.map.size;
  }
}

export function $versioned(context: DecoratorContext, t: Namespace, versions: Enum) {
  context.program.stateMap(versionsKey).set(t, new VersionMap(t, versions));
}

/**
 * Get the version map of the namespace.
 */
export function getVersion(program: Program, namespace: Namespace): VersionMap | undefined {
  return program.stateMap(versionsKey).get(namespace);
}

export function findVersionedNamespace(
  program: Program,
  namespace: Namespace
): Namespace | undefined {
  let current: Namespace | undefined = namespace;

  while (current) {
    if (program.stateMap(versionsKey).has(current)) {
      return current;
    }
    current = current.namespace;
  }

  return undefined;
}

export function $useDependency(
  context: DecoratorContext,
  target: EnumMember | Namespace,
  ...versionRecords: EnumMember[]
) {
  const versions: Array<Version> = [];
  // ensure only valid versions are passed in
  for (const record of versionRecords) {
    const ver = checkIsVersion(context.program, record, context.getArgumentTarget(0)!);
    if (ver) {
      versions.push(ver);
    }
  }

  if (target.kind === "Namespace") {
    let state = context.program.stateMap(useDependencyNamespaceKey).get(target) as Version[];
    if (!state) {
      state = versions;
    } else {
      state.push(...versions);
    }
    context.program.stateMap(useDependencyNamespaceKey).set(target, state);
  } else if (target.kind === "EnumMember") {
    const targetEnum = target.enum;
    let state = context.program.stateMap(useDependencyEnumKey).get(targetEnum) as Map<
      EnumMember,
      Version[]
    >;
    if (!state) {
      state = new Map<EnumMember, Version[]>();
    }
    // get any existing versions and combine them
    const currentVersions = state.get(target) ?? [];
    currentVersions.push(...versions);
    state.set(target, currentVersions);
    context.program.stateMap(useDependencyEnumKey).set(targetEnum, state);
  }
}

export function getUseDependencies(
  program: Program,
  target: Namespace | Enum,
  searchEnum: boolean = true
): Map<Namespace, Map<Version, Version> | Version> | undefined {
  const result = new Map<Namespace, Map<Version, Version> | Version>();
  if (target.kind === "Namespace") {
    let current: Namespace | undefined = target;
    while (current) {
      const data = program.stateMap(useDependencyNamespaceKey).get(current) as Version[];
      if (!data) {
        // See if the namspace has a version enum
        if (searchEnum) {
          const versions = getVersion(program, current)?.getVersions();
          if (versions?.length) {
            const enumDeps = getUseDependencies(program, versions[0].enumMember.enum);
            if (enumDeps) {
              return enumDeps;
            }
          }
        }
        current = current.namespace;
      } else {
        for (const v of data) {
          result.set(v.namespace, v);
        }
        return result;
      }
    }
    return undefined;
  } else if (target.kind === "Enum") {
    const data = program.stateMap(useDependencyEnumKey).get(target) as Map<EnumMember, Version[]>;
    if (!data) {
      return undefined;
    }
    const resolved = resolveVersionDependency(program, data);
    if (resolved instanceof Map) {
      for (const [enumVer, value] of resolved) {
        for (const val of value) {
          const targetNamespace = val.enumMember.enum.namespace;
          if (!targetNamespace) {
            reportDiagnostic(program, {
              code: "version-not-found",
              target: val.enumMember.enum,
              format: { version: val.enumMember.name, enumName: val.enumMember.enum.name },
            });
            return undefined;
          }
          let subMap = result.get(targetNamespace) as Map<Version, Version>;
          if (subMap) {
            subMap.set(enumVer, val);
          } else {
            subMap = new Map([[enumVer, val]]);
          }
          result.set(targetNamespace, subMap);
        }
      }
    }
  }
  return result;
}

function findVersionDependencyForNamespace(program: Program, namespace: Namespace) {
  let current: Namespace | undefined = namespace;
  while (current) {
    const data = program.stateMap(versionDependencyKey).get(current);
    if (data) {
      return data;
    }
    current = current.namespace;
  }
  return undefined;
}

export function getVersionDependencies(
  program: Program,
  namespace: Namespace
): Map<Namespace, Map<Version, Version> | Version> | undefined {
  const useDeps = getUseDependencies(program, namespace);
  if (useDeps) {
    return useDeps;
  }

  const data = findVersionDependencyForNamespace(program, namespace);
  if (data === undefined) {
    return undefined;
  }
  const result = new Map();
  for (const [key, value] of data) {
    result.set(key, resolveVersionDependency(program, value));
  }
  return result;
}

function resolveVersionDependency(
  program: Program,
  data: Map<EnumMember, Version[]> | Version[]
): Map<Version, Version[]> | Version[] {
  if (!(data instanceof Map)) {
    return data;
  }
  const mapping = new Map<Version, Version[]>();
  for (const [key, value] of data) {
    const sourceVersion = getVersionForEnumMember(program, key);
    if (sourceVersion !== undefined) {
      mapping.set(sourceVersion, value);
    }
  }
  return mapping;
}

export interface VersionResolution {
  /**
   * Version for the root namespace. `undefined` if not versioned.
   */
  rootVersion: Version | undefined;

  /**
   * Resolved version for all the referenced namespaces.
   */
  versions: Map<Namespace, Version>;
}

/**
 * Resolve the version to use for all namespace for each of the root namespace versions.
 * @param program
 * @param rootNs Root namespace.
 */
export function resolveVersions(program: Program, rootNs: Namespace): VersionResolution[] {
  const versions = getVersion(program, rootNs);
  const dependencies =
    getVersionDependencies(program, rootNs) ??
    new Map<Namespace, Map<Version, Version> | Version>();
  if (!versions) {
    if (dependencies.size === 0) {
      return [{ rootVersion: undefined, versions: new Map() }];
    } else {
      const map = new Map();
      for (const [dependencyNs, version] of dependencies) {
        if (version instanceof Map) {
          const rootNsName = getNamespaceFullName(rootNs);
          const dependencyNsName = getNamespaceFullName(dependencyNs);
          throw new Error(
            `Unexpected error: Namespace ${rootNsName} version dependency to ${dependencyNsName} should be a picked version.`
          );
        }
        map.set(dependencyNs, version);
      }
      return [{ rootVersion: undefined, versions: map }];
    }
  } else {
    return versions.getVersions().map((version) => {
      const resolution: VersionResolution = {
        rootVersion: version,
        versions: new Map<Namespace, Version>(),
      };
      resolution.versions.set(rootNs, version);

      for (const [dependencyNs, versionMap] of dependencies) {
        if (!(versionMap instanceof Map)) {
          const rootNsName = getNamespaceFullName(rootNs);
          const dependencyNsName = getNamespaceFullName(dependencyNs);
          throw new Error(
            `Unexpected error: Namespace ${rootNsName} version dependency to ${dependencyNsName} should be a mapping of version.`
          );
        }
        resolution.versions.set(dependencyNs, versionMap.get(version)!);
      }

      return resolution;
    });
  }
}

/**
 * Represent the set of projections used to project to that version.
 */
interface VersionProjections {
  version: string | undefined;
  projections: ProjectionApplication[];
}

/**
 * @internal
 */
export function indexVersions(program: Program, versions: Map<Namespace, Version>) {
  const versionKey = program.checker.createType<ObjectType>({
    kind: "Object",
    properties: {},
  } as any);
  program.stateMap(key).set(versionKey, versions);
  return versionKey;
}

function getVersionForNamespace(
  program: Program,
  versionKey: ObjectType,
  namespaceType: Namespace
) {
  return program.stateMap(key).get(versionKey)?.get(namespaceType);
}

const key = createStateSymbol("version-index");
export function buildVersionProjections(program: Program, rootNs: Namespace): VersionProjections[] {
  const resolutions = resolveVersions(program, rootNs);
  return resolutions.map((resolution) => {
    if (resolution.versions.size === 0) {
      return { version: undefined, projections: [] };
    } else {
      const versionKey = indexVersions(program, resolution.versions);
      return {
        version: resolution.rootVersion?.value,
        projections: [
          {
            projectionName: "v",
            arguments: [versionKey],
          },
        ],
      };
    }
  });
}

const versionCache = new WeakMap<Type, [Namespace, VersionMap] | []>();
function cacheVersion(key: Type, versions: [Namespace, VersionMap] | []) {
  versionCache.set(key, versions);
  return versions;
}

export function getVersionsForEnum(program: Program, en: Enum): [Namespace, VersionMap] | [] {
  const namespace = en.namespace;

  if (namespace === undefined) {
    return [];
  }
  const nsVersion = getVersion(program, namespace);

  if (nsVersion === undefined) {
    return [];
  }
  return [namespace, nsVersion];
}

export function getVersions(p: Program, t: Type): [Namespace, VersionMap] | [] {
  if (versionCache.has(t)) {
    return versionCache.get(t)!;
  }

  if (t.kind === "Namespace") {
    const nsVersion = getVersion(p, t);

    if (nsVersion !== undefined) {
      return cacheVersion(t, [t, nsVersion]);
    } else if (t.namespace) {
      return cacheVersion(t, getVersions(p, t.namespace));
    } else {
      return cacheVersion(t, [t, undefined!]);
    }
  } else if (
    t.kind === "Operation" ||
    t.kind === "Interface" ||
    t.kind === "Model" ||
    t.kind === "Union" ||
    t.kind === "Enum"
  ) {
    if (t.namespace) {
      return cacheVersion(t, getVersions(p, t.namespace) || []);
    } else if (t.kind === "Operation" && t.interface) {
      return cacheVersion(t, getVersions(p, t.interface) || []);
    } else {
      return cacheVersion(t, []);
    }
  } else if (t.kind === "ModelProperty") {
    if (t.sourceProperty) {
      return getVersions(p, t.sourceProperty);
    } else if (t.model) {
      return getVersions(p, t.model);
    } else {
      return cacheVersion(t, []);
    }
  } else if (t.kind === "EnumMember") {
    return cacheVersion(t, getVersions(p, t.enum) || []);
  } else if (t.kind === "UnionVariant") {
    return cacheVersion(t, getVersions(p, t.union) || []);
  } else {
    return cacheVersion(t, []);
  }
}

function getAllVersions(p: Program, t: Type): Version[] | undefined {
  const [namespace, _] = getVersions(p, t);
  if (namespace === undefined) return undefined;

  return getVersion(p, namespace)?.getVersions();
}

export enum Availability {
  Unavailable = "Unavailable",
  Added = "Added",
  Available = "Available",
  Removed = "Removed",
}

/**
 * Returns a map of version names and whether a given type is available in that version
 * @param program TypeSpec program
 * @param type Type to get the availability map for
 * @returns the availability map for the type, if applicable
 */
export function getAvailabilityMap(
  program: Program,
  type: Type
): Map<string, Availability> | undefined {
  const avail = new Map<string, Availability>();

  const allVersions = getAllVersions(program, type);
  // if unversioned then everything exists
  if (allVersions === undefined) return undefined;

  const added = getAddedOnVersions(program, type) ?? [];
  const removed = getRemovedOnVersions(program, type) ?? [];

  // if there's absolutely no versioning information, return undefined
  // contextually, this might mean it inherits its versioning info from a parent
  // or that it is treated as unversioned
  if (!added.length && !removed.length) return undefined;

  // implicitly, all versioned things are assumed to have been added at
  // v1 if not specified
  if (!added.length) {
    added.push(allVersions[0]);
  }

  // something isn't available by default
  let isAvail = false;
  for (const ver of allVersions) {
    const add = added.find((x) => x.index === ver.index);
    const rem = removed.find((x) => x.index === ver.index);
    if (rem) {
      isAvail = false;
      avail.set(ver.name, Availability.Removed);
    } else if (add) {
      isAvail = true;
      avail.set(ver.name, Availability.Added);
    } else if (isAvail) {
      avail.set(ver.name, Availability.Available);
    } else {
      avail.set(ver.name, Availability.Unavailable);
    }
  }
  return avail;
}

export function existsAtVersion(p: Program, type: Type, versionKey: ObjectType): boolean {
  const version = toVersion(p, type, versionKey);
  // if unversioned then everything exists
  if (version === undefined) return true;

  const availability = getAvailabilityMap(p, type);
  if (!availability) return true;

  const isAvail = availability.get(version.name)!;
  return [Availability.Added, Availability.Available].includes(isAvail);
}

export function hasDifferentNameAtVersion(p: Program, type: Type, version: ObjectType): boolean {
  return getNameAtVersion(p, type, version) !== "";
}

export function madeOptionalAfter(p: Program, type: Type, version: ObjectType): boolean {
  const appliesAt = appliesAtVersion(getMadeOptionalOn, p, type, version);
  return appliesAt === null ? false : !appliesAt;
}

export function hasDifferentTypeAtVersion(p: Program, type: Type, version: ObjectType): boolean {
  return getTypeBeforeVersion(p, type, version) !== undefined;
}

export function hasDifferentReturnTypeAtVersion(
  p: Program,
  type: Type,
  version: ObjectType
): boolean {
  return getReturnTypeBeforeVersion(p, type, version) !== "";
}

export function getVersionForEnumMember(program: Program, member: EnumMember): Version | undefined {
  const parentEnum = member.enum;
  if (!parentEnum) {
    return undefined;
  }
  const [, versions] = getVersionsForEnum(program, parentEnum);
  return versions?.getVersionForEnumMember(member);
}

/**
 * returns either null, which means unversioned, or true or false depending
 * on whether the change is active or not at that particular version
 */
function appliesAtVersion(
  getMetadataFn: (p: Program, t: Type) => Version | undefined,
  p: Program,
  type: Type,
  versionKey: ObjectType
): boolean | null {
  const version = toVersion(p, type, versionKey);
  if (version === undefined) {
    return null;
  }

  const appliedOnVersion = getMetadataFn(p, type);
  if (appliedOnVersion === undefined) {
    return null;
  }

  const appliedOnVersionIndex = appliedOnVersion.index;
  if (appliedOnVersionIndex === -1) return null;

  const testVersionIndex = version.index;
  if (testVersionIndex === -1) return null;
  return testVersionIndex >= appliedOnVersionIndex;
}

export interface Version {
  name: string;
  value: string;
  namespace: Namespace;
  enumMember: EnumMember;
  index: number;
}
