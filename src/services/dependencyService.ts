/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type ToolingQueryClient = {
  query<T>(soql: string): Promise<{ records: T[]; totalSize?: number; done?: boolean }>;
};

export type AnalyzeOptions = {
  flowName: string;
  namespace?: string;
  scanFlows?: string[];
  versionPolicy?: 'latest' | 'active';
};

export type FlowIdentity = {
  flowName: string;
  namespace: string | null;
  definitionId: string;
  versionId: string;
  versionNumber: number;
  status: string;
};

export type DependencyRelationship = {
  direction: 'incoming' | 'outgoing';
  callerType: string;
  callerName: string;
  callerId?: string;
  callerVersion?: number;
  callerStatus?: string;
  targetType: string;
  targetName: string;
  targetId?: string;
  elementName?: string;
  evidence: 'Flow.Metadata' | 'MetadataComponentDependency';
};

export type MetadataDependencyEdge = {
  MetadataComponentId: string | null;
  MetadataComponentName: string | null;
  MetadataComponentType: string | null;
  MetadataComponentNamespace: string | null;
  RefMetadataComponentId: string | null;
  RefMetadataComponentName: string | null;
  RefMetadataComponentType: string | null;
  RefMetadataComponentNamespace: string | null;
};

export type DependencyReport = {
  generatedAt: string;
  root: FlowIdentity;
  versionPolicy: 'latest' | 'active';
  scannedFlows: FlowIdentity[];
  relationships: DependencyRelationship[];
  mcd: {
    status: 'success' | 'partial' | 'failed';
    reportedEdges: MetadataDependencyEdge[];
    queryCount: number;
    limit: number;
  };
  warnings: string[];
  scope: {
    flowMetadata: 'explicit-flows-only';
    requestedFlowNames: string[];
    orgWideComplete: false;
    apexSourceScanned: false;
  };
};

type FlowDefinitionRecord = {
  Id: string;
  DeveloperName: string;
  NamespacePrefix: string | null;
  ActiveVersionId: string | null;
  LatestVersionId: string | null;
};

type FlowVersionRecord = {
  Id: string;
  DefinitionId: string;
  VersionNumber: number;
  Status: string;
  Metadata: unknown;
};

type ReadFlow = { identity: FlowIdentity; metadata: Record<string, unknown> };

const MAX_FLOW_DEFINITIONS = 20;
const MCD_QUERY_LIMIT = 200;
const MCD_FIELDS: Array<keyof MetadataDependencyEdge> = [
  'MetadataComponentId',
  'MetadataComponentName',
  'MetadataComponentType',
  'MetadataComponentNamespace',
  'RefMetadataComponentId',
  'RefMetadataComponentName',
  'RefMetadataComponentType',
  'RefMetadataComponentNamespace',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const qualifiedName = (name: string, namespace: string | null): string => (namespace ? `${namespace}__${name}` : name);

const soqlLiteral = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function validateName(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(`${label} must be an API name containing only letters, numbers, and underscores.`);
  }
  return trimmed;
}

function validateId(value: string, label: string): string {
  if (!/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(value)) {
    throw new Error(`${label} returned an invalid Salesforce ID.`);
  }
  return value;
}

function metadataObject(value: unknown, name: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Treat unreadable metadata as a required-read failure, not as an empty dependency list.
    }
  }
  throw new Error(`Flow ${name} returned no readable Metadata; its relationships cannot be analyzed.`);
}

function mcdName(name: string | null, namespace: string | null, id: string | null): string {
  return name ? qualifiedName(name, namespace) : id ?? '(unknown)';
}

/** Read-only, deliberately bounded dependency discovery for an explicitly supplied set of Flows. */
export class DependencyService {
  public constructor(private readonly client: ToolingQueryClient) {}

  private static metadataRelationships(
    flows: ReadFlow[],
    root: FlowIdentity,
    warnings: string[]
  ): DependencyRelationship[] {
    const relationships: DependencyRelationship[] = [];
    const rootName = qualifiedName(root.flowName, root.namespace);
    const identities = new Map<string, FlowIdentity>();
    for (const { identity } of flows) {
      identities.set(identity.flowName, identity);
      identities.set(qualifiedName(identity.flowName, identity.namespace), identity);
    }
    for (const { identity, metadata } of flows) {
      const rawSubflows = metadata.subflows;
      const subflows: unknown[] = rawSubflows == null ? [] : Array.isArray(rawSubflows) ? rawSubflows : [rawSubflows];
      for (const subflow of subflows) {
        if (!isRecord(subflow) || typeof subflow.flowName !== 'string' || subflow.flowName.trim().length === 0) {
          warnings.push(
            `Flow ${qualifiedName(identity.flowName, identity.namespace)} contains an unreadable subflow target.`
          );
          continue;
        }
        const targetName = subflow.flowName.trim();
        const target = identities.get(targetName);
        const base = {
          callerType: 'Flow',
          callerName: qualifiedName(identity.flowName, identity.namespace),
          callerId: identity.versionId,
          callerVersion: identity.versionNumber,
          callerStatus: identity.status,
          targetType: 'FlowDefinition',
          targetName: target ? qualifiedName(target.flowName, target.namespace) : targetName,
          ...(target ? { targetId: target.definitionId } : {}),
          ...(typeof subflow.name === 'string' ? { elementName: subflow.name } : {}),
          evidence: 'Flow.Metadata' as const,
        };
        if (identity.definitionId === root.definitionId) relationships.push({ direction: 'outgoing', ...base });
        if (targetName === root.flowName || targetName === rootName) {
          relationships.push({ direction: 'incoming', ...base });
        }
      }
    }
    return relationships;
  }

  public async analyze(options: AnalyzeOptions): Promise<DependencyReport> {
    const flowName = validateName(options.flowName, 'Flow name');
    const namespace = options.namespace?.trim() ? validateName(options.namespace, 'Namespace') : null;
    const requestedFlowNames = [
      ...new Set([flowName, ...(options.scanFlows ?? []).map((name) => validateName(name, 'Scan Flow name'))]),
    ];
    if (requestedFlowNames.length > MAX_FLOW_DEFINITIONS) {
      throw new Error(`At most ${MAX_FLOW_DEFINITIONS} explicit Flows are supported, including the root Flow.`);
    }
    const versionPolicy = options.versionPolicy ?? 'latest';
    if (versionPolicy !== 'latest' && versionPolicy !== 'active') {
      throw new Error('Version policy must be latest or active.');
    }

    const flows: ReadFlow[] = [];
    for (const name of requestedFlowNames) {
      // Keep the bounded org reads sequential instead of issuing a burst of metadata requests.
      // eslint-disable-next-line no-await-in-loop
      flows.push(await this.readFlow(name, namespace, versionPolicy));
    }
    const root = flows[0].identity;
    const warnings = [
      'Flow.Metadata scanning is limited to the explicitly requested Flows and selected versions; incoming callers are not org-wide complete.',
      'Subflow targets are definition/name references; this report does not establish which child version executes at runtime.',
      'MetadataComponentDependency is supplementary evidence. An empty response does not prove that no references exist.',
      'Dependency-API rows can be definition-level and are not guaranteed to describe only the selected Flow version.',
      'Apex source and runtime-resolved references were not scanned; this report is not a safe-delete or deployment-completeness guarantee.',
    ];
    const relationships = DependencyService.metadataRelationships(flows, root, warnings);
    const mcd = await this.readMetadataDependencies(root, relationships, warnings);

    return {
      generatedAt: new Date().toISOString(),
      root,
      versionPolicy,
      scannedFlows: flows.map((flow) => flow.identity),
      relationships: [
        ...new Map(relationships.map((relationship) => [JSON.stringify(relationship), relationship])).values(),
      ],
      mcd,
      warnings,
      scope: {
        flowMetadata: 'explicit-flows-only',
        requestedFlowNames,
        orgWideComplete: false,
        apexSourceScanned: false,
      },
    };
  }

  private async readFlow(
    flowName: string,
    namespace: string | null,
    versionPolicy: 'latest' | 'active'
  ): Promise<ReadFlow> {
    const name = qualifiedName(flowName, namespace);
    const namespacePredicate = namespace ? soqlLiteral(namespace) : 'null';
    const definitions = await this.client.query<FlowDefinitionRecord>(
      'SELECT Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId FROM FlowDefinition ' +
        `WHERE DeveloperName = ${soqlLiteral(flowName)} AND NamespacePrefix = ${namespacePredicate} LIMIT 2`
    );
    if (definitions.records.length === 0)
      throw new Error(`Flow definition ${name} was not found or is not accessible.`);
    if (definitions.records.length !== 1 || (definitions.totalSize ?? 1) > 1 || definitions.done === false) {
      throw new Error(`Flow definition ${name} did not resolve unambiguously; no version was selected.`);
    }
    const definition = definitions.records[0];
    const definitionId = validateId(definition.Id, `Flow definition ${name}`);
    const selectedId = versionPolicy === 'active' ? definition.ActiveVersionId : definition.LatestVersionId;
    if (!selectedId) throw new Error(`Flow ${name} has no ${versionPolicy} version; no fallback version was selected.`);
    const versionId = validateId(selectedId, `Flow ${name} ${versionPolicy} version`);
    const versions = await this.client.query<FlowVersionRecord>(
      `SELECT Id, DefinitionId, VersionNumber, Status, Metadata FROM Flow WHERE Id = ${soqlLiteral(versionId)} LIMIT 1`
    );
    if (versions.records.length !== 1 || (versions.totalSize ?? 1) > 1 || versions.done === false) {
      throw new Error(`The selected ${versionPolicy} version for Flow ${name} was not readable as a single record.`);
    }
    const version = versions.records[0];
    if (version.Id !== versionId || version.DefinitionId !== definitionId) {
      throw new Error(`The selected version for Flow ${name} did not match its resolved definition and version IDs.`);
    }
    if (!Number.isInteger(version.VersionNumber) || version.VersionNumber < 1 || typeof version.Status !== 'string') {
      throw new Error(`The selected version for Flow ${name} returned incomplete version identity.`);
    }
    return {
      identity: {
        flowName: definition.DeveloperName,
        namespace: definition.NamespacePrefix ?? null,
        definitionId,
        versionId,
        versionNumber: version.VersionNumber,
        status: version.Status,
      },
      metadata: metadataObject(version.Metadata, name),
    };
  }

  private async readMetadataDependencies(
    root: FlowIdentity,
    relationships: DependencyRelationship[],
    warnings: string[]
  ): Promise<DependencyReport['mcd']> {
    const edges = new Map<string, MetadataDependencyEdge>();
    let successfulQueries = 0;
    let incomplete = false;
    let queryCount = 0;
    for (const id of [root.definitionId, root.versionId]) {
      for (const direction of ['incoming', 'outgoing'] as const) {
        const field = direction === 'incoming' ? 'RefMetadataComponentId' : 'MetadataComponentId';
        queryCount += 1;
        try {
          // Four bounded requests stay sequential to avoid unnecessary concurrent load on the org.
          // eslint-disable-next-line no-await-in-loop
          const result = await this.client.query<MetadataDependencyEdge>(
            `SELECT ${MCD_FIELDS.join(', ')} FROM MetadataComponentDependency ` +
              `WHERE ${field} = ${soqlLiteral(id)} LIMIT ${MCD_QUERY_LIMIT}`
          );
          successfulQueries += 1;
          if (
            result.records.length >= MCD_QUERY_LIMIT ||
            (result.totalSize ?? 0) >= MCD_QUERY_LIMIT ||
            result.done === false
          ) {
            incomplete = true;
            warnings.push(
              `MetadataComponentDependency ${direction} query for ${id} reached its bounded result limit or reported more data; results may be incomplete.`
            );
          }
          for (const rawEdge of result.records) {
            const edge = Object.fromEntries(
              MCD_FIELDS.map((key) => [key, rawEdge[key] ?? null])
            ) as MetadataDependencyEdge;
            edges.set(JSON.stringify(edge), edge);
            relationships.push({
              direction,
              callerType: edge.MetadataComponentType ?? '(unknown)',
              callerName: mcdName(
                edge.MetadataComponentName,
                edge.MetadataComponentNamespace,
                edge.MetadataComponentId
              ),
              ...(edge.MetadataComponentId ? { callerId: edge.MetadataComponentId } : {}),
              targetType: edge.RefMetadataComponentType ?? '(unknown)',
              targetName: mcdName(
                edge.RefMetadataComponentName,
                edge.RefMetadataComponentNamespace,
                edge.RefMetadataComponentId
              ),
              ...(edge.RefMetadataComponentId ? { targetId: edge.RefMetadataComponentId } : {}),
              evidence: 'MetadataComponentDependency',
            });
          }
        } catch (error) {
          incomplete = true;
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`MetadataComponentDependency ${direction} query for ${id} failed: ${message}`);
        }
      }
    }
    return {
      status: successfulQueries === 0 ? 'failed' : incomplete ? 'partial' : 'success',
      reportedEdges: [...edges.values()],
      queryCount,
      limit: MCD_QUERY_LIMIT,
    };
  }
}
