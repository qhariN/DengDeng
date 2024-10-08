import OpenAI from 'openai'
import { threadStore } from '../stores/thread'
import { openaiStore } from '../stores/openai'
import { assistantStore } from '../stores/assistant'
import { ref } from 'vue'
import { Tools } from '../tools'

export const message = ref('')

export function useAssistant() {
  async function sendMessage(message: string) {
    await openaiStore.threads.messages.create(await threadStore.id(), {
      role: 'user',
      content: [{
        type: 'text',
        text: message,
      }],
    })

    const run = await openaiStore.threads.runs.createAndPoll(
      await threadStore.id(),
      { assistant_id: await assistantStore.id() },
      { pollIntervalMs: 1 },
    )

    await handleRunStatus(run)
  }

  async function handleRunStatus(run: OpenAI.Beta.Threads.Runs.Run) {
    if (run.status === 'completed') {
      const lastMessage = await openaiStore.threads.messages.list(await threadStore.id(), { order: 'desc', limit: 1 })
      message.value = (lastMessage.data[0].content[0] as any).text.value
    } else if (run.status === 'requires_action') {
      await handleRequiresAction(run)
    } else {
      console.error('Run did not complete:', run)
    }
  }

  async function handleRequiresAction(run: OpenAI.Beta.Threads.Runs.Run) {
    if (
      run.required_action &&
      run.required_action.submit_tool_outputs &&
      run.required_action.submit_tool_outputs.tool_calls
    ) {
      const toolOutputs = await Promise.all(run.required_action.submit_tool_outputs.tool_calls.map(
        async (tool) => {
          try {
            const parameters = JSON.parse(tool.function.arguments)
            const toolFunction = Tools[tool.function.name as keyof typeof Tools]
            const res = await toolFunction(parameters)
  
            return {
              tool_call_id: tool.id,
              output: res,
            }
          } catch (error) {
            throw new Error(`Unknown tool call function: ${tool.function.name}`)
          }
        },
      ))

      if (toolOutputs.length > 0) {
        run = await openaiStore.threads.runs.submitToolOutputsAndPoll(
          await threadStore.id(),
          run.id,
          { tool_outputs: toolOutputs },
          { pollIntervalMs: 1 },
        )
        console.log('Tool outputs submitted successfully.')
      } else {
        console.log('No tool outputs to submit.')
      }
  
      return handleRunStatus(run)
    }
  }

  return {
    sendMessage,
  }
}
