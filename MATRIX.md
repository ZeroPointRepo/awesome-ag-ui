# AG-UI capability matrix

Every framework integration in `ag-ui-protocol/ag-ui` against every capability the protocol's dojo defines.
Read from `apps/dojo/src/menu.ts` and `apps/dojo/e2e/tests` at commit `1edff613daf16f12438dd19ce283d61d1907c650` on 2026-08-27.

✅ declared and driven by an end-to-end spec · ◻️ declared, no spec resolved · 🚫 present in the config but commented out

| Integration | `agentic_chat` | `agentic_generative_ui` | `human_in_the_loop` | `interrupt` | `predictive_state_updates` | `shared_state` | `tool_based_generative_ui` | `backend_tool_rendering` | `agentic_chat_reasoning` | `agentic_chat_multimodal` | `subgraphs` | `multi_agent` | `v1_agentic_chat` | `a2ui_fixed_schema` | `a2ui_dynamic_schema` | `a2ui_advanced` | `a2ui_recovery` | `crew_chat` | `error_flow` | `background_agents` | `observational_memory` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AWS Strands (Python) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  |  |  |  |
| AWS Strands (TypeScript) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  |  |  |  |
| CrewAI Flows | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  |  | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ |  |  |
| CrewAI Conversational Flows | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  |  | ✅ | ✅ | ✅ |  | ✅ |  |  |  |  |
| LangGraph (FastAPI) | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ |  |  |  |  |  |
| LangGraph (Python) | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ |  |  |  |  |  |
| LangGraph (Typescript) | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | 🚫 | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ | ✅ |  |  |  |  |
| Mastra | ✅ |  | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ | ✅ |  |  | ✅ | ✅ | ✅ |  | ✅ |  |  |  | ✅ |
| AG-UI .NET SDK | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ |  |  |  |  | ✅ | ✅ | ✅ | ✅ | ✅ |  |  |  |  |
| Mastra Agent (Local) | ✅ |  | ✅ | ✅ |  | ✅ | ✅ | ✅ |  |  |  |  | ✅ | ✅ | ✅ |  | ✅ |  |  | ✅ | ✅ |
| Agno | ✅ | ◻️ | ✅ |  | ◻️ | ◻️ | ✅ | ✅ | ◻️ | ◻️ |  |  | ✅ |  |  |  |  |  |  |  |  |
| Google ADK | ✅ |  | ✅ |  | ✅ | ✅ | ✅ | ✅ |  |  |  |  | ✅ | ✅ | ✅ |  | ✅ |  |  |  |  |
| Microsoft Agent Framework (.NET) | ✅ | ◻️ | ◻️ |  | ◻️ | ◻️ | ◻️ | ◻️ |  |  | ◻️ |  | ◻️ |  |  |  |  |  |  |  |  |
| Microsoft Agent Framework (Python) | ✅ | ◻️ | ◻️ |  | ◻️ | ◻️ | ◻️ | ◻️ |  | ◻️ |  |  | ◻️ |  |  |  |  |  |  |  |  |
| AG2 | ✅ | ◻️ | ◻️ |  |  | ◻️ | ◻️ | ◻️ |  | ◻️ |  |  | ◻️ |  |  |  |  |  |  |  |  |
| Pydantic AI | ✅ | ✅ | ✅ |  | 🚫 | ✅ | ✅ | ✅ |  | ✅ |  |  | ✅ |  |  |  |  |  |  |  |  |
| Server Starter (All Features) | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ | 🚫 |  |  |  | ✅ |  |  |  |  |  |  |  |  |
| LlamaIndex | ✅ | ✅ | ✅ |  |  | ✅ |  | ✅ |  | ✅ |  |  | ✅ |  |  |  |  |  |  |  |  |
| Spring AI | ✅ | ◻️ | ◻️ |  |  | ◻️ | ◻️ |  |  |  |  |  | ◻️ |  |  |  |  |  |  |  |  |
| Claude Agent SDK (Python) | ✅ |  | ✅ |  |  | ✅ | ✅ | ✅ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Claude Agent SDK (Typescript) | ✅ |  | ✅ |  |  | ✅ | ✅ | ✅ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Open Agent Spec (LangGraph) | ✅ |  | ◻️ |  |  |  | ◻️ | ◻️ |  |  |  |  | ◻️ |  |  |  |  |  |  |  |  |
| Open Agent Spec (Wayflow) | ✅ |  | ◻️ |  |  |  | ◻️ | ◻️ |  |  |  |  | ◻️ |  |  |  |  |  |  |  |  |
| Claude Managed Agents (.NET) | ◻️ |  | ◻️ |  |  |  | ◻️ | ◻️ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Claude Managed Agents (Python) | ◻️ |  | ◻️ |  |  |  | ◻️ | ◻️ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Claude Managed Agents (Typescript) | ◻️ |  | ◻️ |  |  |  | ◻️ | ◻️ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Langroid | ✅ | ✅ |  |  |  | ✅ |  | ✅ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| IBM watsonx orchestrate | ◻️ |  |  |  |  |  |  |  |  |  |  |  | ◻️ |  |  |  |  |  |  |  |  |
| Middleware Starter | ✅ |  |  |  |  |  |  |  |  |  |  |  | ✅ |  |  |  |  |  |  |  |  |
| Server Starter | ✅ |  |  |  |  |  |  |  |  |  |  |  | ✅ |  |  |  |  |  |  |  |  |

30 integrations · 23 capabilities · 258 declared slots · 203 with a spec · 200 spec files read, 3 unresolved, 0 unreadable.
