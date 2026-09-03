import { z } from 'zod';
export const RunState=z.enum(['PLANNED','RUNNING','WAITING_APPROVAL','EXECUTING','VERIFYING','COMPLETED','FAILED','CANCELLED']);
export const RiskLevel=z.union([z.literal(0),z.literal(1),z.literal(2)]);
export const ToolRequest=z.object({name:z.string(),input:z.record(z.unknown()),risk:RiskLevel.optional()});
export const Plan=z.object({summary:z.string(),steps:z.array(z.string()),tools:z.array(ToolRequest)});
export const CreateRunRequest=z.object({repository:z.string().min(1),request:z.string().min(3)});
export type RunState=z.infer<typeof RunState>; export type Plan=z.infer<typeof Plan>; export type ToolRequest=z.infer<typeof ToolRequest>;
export type Evidence={runId:string;request:string;plan:string[];tools:string[];filesChanged:string[];commands:string[];tests:string[];gitDiff:string;result:'SUCCESS'|'PENDING'|'FAILED'};

export type {IPlugin,IPluginContext,ITaskDefinition,IEvidenceStrategy,TaskContext} from './plugin.types.js';
