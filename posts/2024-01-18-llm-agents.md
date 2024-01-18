# LLM Agents: Overview and implementation

In this article, we explore LLM Agents. A popular idea having emerged from the capabilities of LLMs.

What do we exactly mean by an agent? And how do we implement them? This is what we will explore in this article.

## Definition of an LLM Agent

### Agent = LLM + State + Tools

* The **LLM** component has the reasoning abilities to select the right action in a given situation. An action can be to respond with a message or to use a tool. E.g. GPT4.
* The **State** component is the agents memory of previous messages and results from used tools. E.g. stored in a database.
* The **Tools (aka. Actions)** component is the agents ability to interact with the external world. E.g. API calls to other systems and services.

Agents can be **triggered** by manual user input or by external events. External events can for example be a change in a database, monitoring of an email inbox, or time-based trigger.

An **autonomous agent** is an agent that is triggered by an event other than a user's direct request. It gets particularly interesting when the output of the agent is used to trigger a future invocation of itself or another agent. This can be done by maintaining state in a database and scheduling triggers with something like a cron job based on the state and how it changes.

## Types of agents

The above definition of an agent is very general. It can be applied to many different types of agents. In this section, we will explore some of the most common types of agents.

### Stateless agents

Stateless agents do not have a state. They are triggered by an event and respond with a message or use a tool. They do not remember anything about previous events. They are useful for simple tasks that do not require any memory or ability to perform a sequence of actions.

**Example**: Agent that plays music based on a user's request.

### Workflow agents

Workflow agents have a state and can perform a sequence of actions. But this sequence is fixed and does not depend on the state or the input. However, the actual tool use does depend on the state and the input. They are useful for tasks that require a sequence of actions but do not require any reasoning.

**Example**: A lead generation agent that scrapes linkedin, updates a google sheet, and sends personalized messages to the leads.

### RAG is a workflow agent

A RAG system (retrieval augmented generation) can be seen as a workflow agent. It typically performs query rewrite, retrieves relevant documents, and then generates a response. More involved RAG systems have many more steps. This is the core of [Sana AI](https://sana.ai/), that I'm involved in building at [Sana Labs](https://sanalabs.com/). We have an extremely advanced RAG and are working on making it even more general, and adding more general agent capabilities.

### General agents

General agents have a state and can perform actions both in sequence and in parallel. The actions can be performed in any order, and depends on the input and the state that is being built up as the agent runs. General agents are useful for tasks that require more flexibility and complex reasoning to perform multi-step actions.

**Example**: A human is a general agent. A general LLM agent could be a virtual assisstant, capable of performing a wide range of tasks.

## Why don't we see more general agents in practice?

Todays state-of-the-art LLMs (GPT4) are simply not good enough in their reasoning capabilities to perform correct tool use when the state is complex or requires a clever combination of tools.

Most agents we encounter in practice are therefore stateless or workflow agents. The release of GPT5 will likely change this.

## Implementation

Let's build a general agent to demonstrate the fundamental concepts. We will do this using the OpenAI [Assistant API](https://platform.openai.com/docs/assistants/overview) which gives nice abstractions for the LLM, managing state, and tool selection. Running the tool is of course separate.

### LLM agents "use" tools, but the tools are external

A common confusion is that the agent itself somehow runs the tools. This is not the case. The agent is simply an LLM knowing what tools it has available; described in text in its prompt. The LLM can simply asks for a tool to be used. A tool is of course just software that is being run. We as engineers built he system that does the actual execution of the tools and return the tool output to the LLM agent.

### The OpenAI Assistant API

Think of the [Assistant API](https://platform.openai.com/docs/assistants/overview) as the [Text Generation API](https://platform.openai.com/docs/guides/text-generation) and [Function Calling API](https://platform.openai.com/docs/guides/function-calling) combined with a _state_. This state is called [Threads](https://platform.openai.com/docs/assistants/how-it-works/managing-threads-and-messages) in the Assistant API.

Practical use of agents in production typically involves combining these APIs manually and managing state in a database to get more control of the setup. But for this article, we will use the Assistant API to keep it simple and focus on demonstrating the core concepts.

### Code

See the [GitHub repository](github.com/viktorqvarfordt/llm-agent-demo) for full code and runnable exampel. It's about 150 lines of code to orchestrate the agent and to build a CLI for interacting with it.

The agent is hooked up with some simple tools: `getCurrentLocation`, `getCurrentWeather`, `playMusic`. Consider the user request "Play music that fit's the mood of the weather". For this, the agent needs to know the current location, based on which it can get the the current weather, which it can use to select a relevant song, and then use the playMusic tool.

**Example output:**

```
> Play music that fit's the mood of the weather

<< Agent requests function calls: [ getCurrentLocation({}) ]
>> Submitting function outputs: [ "Stockholm, SE" ]

<< Agent requests function calls: [ getCurrentWeather({"location":"Stockholm, SE"}) ]
>> Submitting function outputs: [ "🌨  -7°C" ]

<< Agent requests function calls: [ playMusic({"songName":"Winter Winds","artistName":"Mumford & Sons"}) ]
>> Submitting function outputs: [ "Playing Winter Winds by Mumford & Sons" ]

< I've set "Winter Winds" by Mumford & Sons to play, which should match the chilly and snowy mood of the weather in Stockholm. Enjoy the music! 🎵❄️
```

Here we can see the agent reasoning about the weather and selecting a song that fits the mood of the weather. The agent is general in the sense that the tools runs in multiple steps and depend on both the input and the state.

## Conclusion

We've seen how LLM agents can be implemented and what they can be used for. We introduced the distinction of stateless agents, workflow angents, and general agents, based on their capabilities and complexity.

We also saw that state-of-the-art LLMs (GPT4) are not good enough to build general agents. But this will likely change with the release of GPT5 later this year.

**Prediction:** 2024 is the year of the agents. We will start seeing real agents in production for a range of use cases.

<img width="610" alt="image" src="https://github.com/ViktorQvarfordt/blog/assets/344809/affd55ca-b70a-40d3-8fb3-36eeb3c1becf">
