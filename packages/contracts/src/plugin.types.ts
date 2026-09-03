import { z } from 'zod';
export interface IPlugin { name:string; version:string; register:(context:IPluginContext)=>Promise<void>|void; }
export interface IPluginContext { registerTask:(task:ITaskDefinition)=>void; registerEvidenceStrategy:(strategy:IEvidenceStrategy)=>void; loadPolicies:(policiesDir:string)=>Promise<Record<string,unknown>>; }
export interface ITaskDefinition { id:string; schema:z.ZodTypeAny; handler:(input:unknown,context:TaskContext)=>Promise<unknown>; requiredApprovalLevel?:1|2|3; }
export interface IEvidenceStrategy { id:string; collect:(data:unknown)=>Promise<Record<string,unknown>>; }
export interface TaskContext { agentId:string; traceId:string; approvalGateway:{check:(level:number)=>Promise<boolean>}; }
