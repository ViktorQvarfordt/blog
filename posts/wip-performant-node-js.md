# WIP: Performant Node.js

**TL;DR** Node has worker threads that achieve the same type of parallelism as native Node IO, lifting the heavy weight from the event loop, but CPU intensive work can be moved elsewhere.

### Introduction

We are starting to write some computationally non-trivial code in Node. While Node is not designed for CPU intensive work it is better than one might think. I want to share some details on this.

Modern JavaScript engines compile JS directly to native machine code with JIT compilation before executing it, in contrast to Python which is interpreted. The compiled code is additionally optimized (and re-optimized) dynamically at runtime, based on heuristics of the code’s execution profile.

### Single-threaded event loop

JS engines are single threaded and achieve asynchronous concurrency with an event loop, conceptually implemented like this:

```ts
while (queue.waitForMessage()) {
  queue.processNextMessage()
}
```

`queue.waitForMessage()` waits synchronously for a message to arrive. The event loop has the [run-to-completion](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop#run-to-completion) property where each message is processed completely before any other message is processed. A (non-async) function call will fully complete execution before the next message is processed. Two functions with multiple async steps can interleave each other in the event loop; this is how concurrency is achieved (not parallelism).

### Multi-threaded runtime

The JS engine (eg. V8, responsible for executing JS code) is part of a JS runtime (eg. Node, providing APIs for file system access etc.)

Node itself is a multi-threaded application and uses an event-driven, non-blocking IO model. This is evident when you use one of the standard library’s asynchronous methods to perform IO operations, such as reading a file or making a network request. These tasks are delegated to a separate pool of threads that Node creates and maintains using the libuv C library. This means IO operations in Node run outside the event loop and allow for true parallelism.

This is what makes Node an excellent runtime for IO intensive work. As long as each message in the event loop is light (like scheduling an IO operation), the single-threaded nature of the JS engine is not going to be the bottleneck.

If the runtime has only one (or a fraction of one) CPU core available, which is common for http servers or cloud functions, parallelism cannot be achieved and the single-threaded nature of Node is not a limitation. In this case, goroutines behave essentially the same as the Node event loop. (A more low-level language like Go or Rust will still be faster to execute computations. If we start having performance issues of this kind, we may look at such solutions.)

### Worker threads for CPU intensive code

Let’s say we have multiple cores available. Wouldn’t it be cool if we could run our own CPU intensive code in a separate thread like Node does IO operations? This is possible with the native Node module [worker_threads](https://nodejs.org/api/worker_threads.html). Workers communicate via messages, not shared memory. This avoids race conditions and is similar to goroutines. (It is possible to have shared memory with SharedArrayBuffer.)

The optimal use of worker threads is to have a static worker pool with one worker per core. This avoids the overhead of creating worker threads. There are libraries that wrap worker_threads and give a high-level interface for a fast and efficient worker thread pool implementation, such as [piscina](https://github.com/piscinajs/piscina).

There is of course complexity involved in using this and I’m not suggesting we should start using it unless we identify such bottlenecks in our system. I just want everyone to be aware of the possibility.

### Run CPU intensive work elsewhere

Heavy computation happens primarily in the database, the Triton model server, or optimized libraries. Our services primarily do lightweight computation, call libraries, orchestrate IO and parse/validate/serialize data. Most likely, we can simply scale our services horizontally. If we were to have some very heavy code, we could deploy that as a separate service with an optimized implementation. (edited) 
