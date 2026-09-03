export interface AgentGoal { intent:string; parameters:Record<string,unknown>; context?:Record<string,unknown>; }
export interface ExecutionStep { taskId:string; input:Record<string,unknown>; output?:unknown; evidence?:Record<string,unknown>; approval:{level:number;approved:boolean;reason?:string}; timestamp:string; status:'pending'|'approved'|'executed'|'failed'; }
export interface ExecutionReport { agentId:string; goal:AgentGoal; steps:ExecutionStep[]; finalOutput:unknown; summary:string; totalTime:number; success:boolean; }
