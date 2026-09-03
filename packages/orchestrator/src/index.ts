import type {IPlugin} from '@agent/contracts';
import {initAgent} from '@agent/core';
import {ExamplePlugin} from '@agent/plugin-example';
import {LLMPlanner,GeminiProvider} from '@agent/llm-planner';
import {Planner as KeywordPlanner} from './planner.js';
import {AgentLoop} from './loop.js';
import type {AgentGoal} from './types.js';
export type {AgentGoal,ExecutionReport,ExecutionStep} from './types.js';
export {KeywordPlanner as Planner,AgentLoop};
export async function createOrchestrator(plugins:IPlugin[]=[ExamplePlugin],geminiApiKey?:string){
  const agent=await initAgent({plugins}); const keyword=new KeywordPlanner(agent.taskRegistry);
  const fallback={plan:async(intent:string)=>({taskId:await keyword.plan({intent,parameters:{}}),parameters:{}})};
  let provider:GeminiProvider|null=null; if(geminiApiKey){try{provider=new GeminiProvider(geminiApiKey)}catch(error){console.warn('Gemini unavailable; using keyword planner',error)}}
  const planner=new LLMPlanner(agent.taskRegistry.getAll(),provider,fallback);
  const selectedPlanner=provider?{plan:(goal:AgentGoal)=>planner.plan(goal.intent)}:{plan:(goal:AgentGoal)=>keyword.plan(goal)};
  const orchestrator=new AgentLoop(selectedPlanner,agent.executeTask,agent.strategyRegistry);
  return {agent,orchestrator,run:(goal:AgentGoal)=>orchestrator.run(goal)};
}
