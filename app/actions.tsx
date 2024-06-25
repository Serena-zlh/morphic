import {
  StreamableValue,
  createAI,
  createStreamableUI,
  createStreamableValue,
  getAIState,
  getMutableAIState
} from 'ai/rsc'
import { CoreMessage, generateId, ToolResultPart } from 'ai'
import { Spinner } from '@/components/ui/spinner'
import { Section } from '@/components/section'
import { FollowupPanel } from '@/components/followup-panel'
import { inquire, researcher, taskManager, querySuggestor } from '@/lib/agents'
import { writer } from '@/lib/agents/writer'
import { saveChat } from '@/lib/actions/chat'
import { Chat } from '@/lib/types'
import { AIMessage } from '@/lib/types'
import { UserMessage } from '@/components/user-message'
import { SearchSection } from '@/components/search-section'
import SearchRelated from '@/components/search-related'
import { CopilotDisplay } from '@/components/copilot-display'
import RetrieveSection from '@/components/retrieve-section'
import { VideoSearchSection } from '@/components/video-search-section'
import { transformToolMessages } from '@/lib/utils'
import { AnswerSection } from '@/components/answer-section'
import { ErrorCard } from '@/components/error-card'
import { SearchResults } from '@/components/search-results'
import { SearchSkeleton } from '@/components/search-skeleton'

async function submit(
  formData?: FormData,
  skip?: boolean,
  retryMessages?: AIMessage[]
) {
  'use server'

  const aiState = getMutableAIState<typeof AI>()
  const uiStream = createStreamableUI()
  const isGenerating = createStreamableValue(true)
  const isCollapsed = createStreamableValue(false)

  const aiMessages = [...(retryMessages ?? aiState.get().messages)]
  // Get the messages from the state, filter out the tool messages
  //  CoreMessage like {role:'', content:''}
  const messages: CoreMessage[] = aiMessages
    .filter(
      message =>
        message.role !== 'tool' &&
        message.type !== 'followup' &&
        message.type !== 'related' &&
        message.type !== 'end'
    )
    .map(message => {
      const { role, content } = message
      return { role, content } as CoreMessage
    })

  // goupeiId is used to group the messages for collapse
  const groupeId = generateId()

  const useSpecificAPI = process.env.USE_SPECIFIC_API_FOR_WRITER === 'true'
  const useOllamaProvider = false

  const maxMessages = 5
  // Limit the number of messages to the maximum
  messages.splice(0, Math.max(messages.length - maxMessages, 0))
  // Get the user input from the form data
  const userInput = skip
    ? `{"action": "skip"}`
    : (formData?.get('input') as string)

  const content = skip
    ? userInput
    : formData
    ? JSON.stringify(Object.fromEntries(formData))
    : null
  const type = skip
    ? undefined
    : formData?.has('input')
    ? 'input'
    : formData?.has('related_query')
    ? 'input_related'
    : 'inquiry'

  // Add the user message to the state
  if (content) {
    aiState.update({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages,
        {
          id: generateId(),
          role: 'user',
          content,
          type
        }
      ]
    })
    messages.push({
      role: 'user',
      content
    })
  }

  async function getTurnProcess() {
    uiStream.append(<Spinner />)
    isCollapsed.done(true)

    uiStream.update(
      <Section className="pt-2 pb-0">
        <SearchSkeleton />
      </Section>
    )
    //step1 search
    console.log('search:', userInput)
    const searchResponse = await fetch(process.env.BACKEND_URL + '/search', {
      method: 'POST',
      body: JSON.stringify({
        query: userInput,
        search_source: 'web',
        is_eval: false,
        user_id: 'string',
        zipcode: '10086'
      })
    })

    const { turn_id, result } = await searchResponse.json()

    uiStream.update(
      <Section title="Sources">
        <SearchResults results={result} />
      </Section>
    )

    aiState.update({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages,
        {
          id: groupeId,
          role: 'assistant',
          content: result,
          name: 'search',
          type: 'tool'
        }
      ]
    })

    // step2 Generate the answer
    let answer = ''
    let errorOccurred = false
    const streamText = createStreamableValue<string>()

    const answerResponse = await fetch(process.env.BACKEND_URL + '/generate', {
      method: 'POST',
      body: JSON.stringify({
        turn_id,
        model_id: null
      })
    })

    // wiki: https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams

    if (answerResponse?.body) {
      uiStream.append(<AnswerSection result={streamText.value} />)

      let done = false
      const utf8Decoder = new TextDecoder('utf-8')
      const reader = answerResponse.body?.getReader()

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        const text = utf8Decoder.decode(value)

        answer += text
        streamText.update(answer)
      }

      messages.push({
        role: 'assistant',
        content: answer
      })

      streamText.done()
      aiState.update({
        ...aiState.get(),
        messages: [
          ...aiState.get().messages,
          {
            id: groupeId,
            role: 'assistant',
            content: answer,
            type: 'answer'
          }
        ]
      })
    }

    // step3 next one
    uiStream.append(
      <Section title="Follow-up">
        <FollowupPanel />
      </Section>
    )
    aiState.done({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages,
        // {
        //   id: groupeId,
        //   role: 'assistant',
        //   content: JSON.stringify(relatedQueries),
        //   type: 'related'
        // },
        {
          id: groupeId,
          role: 'assistant',
          content: 'followup',
          type: 'followup'
        }
      ]
    })

    // 处理完成，关闭
    isGenerating.done(false)
    uiStream.done()
  }

  // processEvents()

  getTurnProcess()

  return {
    id: generateId(),
    isGenerating: isGenerating.value,
    component: uiStream.value,
    isCollapsed: isCollapsed.value
  }
}

export type AIState = {
  messages: AIMessage[]
  chatId: string
  isSharePage?: boolean
}

export type UIState = {
  id: string
  component: React.ReactNode
  isGenerating?: StreamableValue<boolean>
  isCollapsed?: StreamableValue<boolean>
}[]

const initialAIState: AIState = {
  chatId: generateId(),
  messages: []
}

const initialUIState: UIState = []

// AI is a provider you wrap your application with so you can access AI and UI state in your components.
export const AI = createAI<AIState, UIState>({
  actions: {
    submit
  },
  initialUIState,
  initialAIState,
  onGetUIState: async () => {
    'use server'

    // TODO 恢复历史记录
    // const historyFromDB: ServerMessage[] = await loadChatFromDB();
    // const historyFromApp: ServerMessage[] = getAIState();
    const aiState = getAIState()

    if (aiState) {
      const uiState = getUIStateFromAIState(aiState as Chat)

      return uiState
    } else {
      return
    }
  },
  // TODO: save the state to database if done = true.
  // trigger call when state update
  onSetAIState: async ({ state, done }) => {
    'use server'

    // // Check if there is any message of type 'answer' in the state messages
    // if (!state.messages.some(e => e.type === 'answer')) {
    //   return
    // }

    // const { chatId, messages } = state
    // const createdAt = new Date()
    // const userId = 'anonymous'
    // const path = `/search/${chatId}`
    // const title =
    //   messages.length > 0
    //     ? JSON.parse(messages[0].content)?.input?.substring(0, 100) ||
    //       'Untitled'
    //     : 'Untitled'
    // // Add an 'end' message at the end to determine if the history needs to be reloaded
    // const updatedMessages: AIMessage[] = [
    //   ...messages,
    //   {
    //     id: generateId(),
    //     role: 'assistant',
    //     content: `end`,
    //     type: 'end'
    //   }
    // ]

    // const chat: Chat = {
    //   id: chatId,
    //   createdAt,
    //   userId,
    //   path,
    //   title,
    //   messages: updatedMessages
    // }
    // await saveChat(chat)
  }
})

export const getUIStateFromAIState = (aiState: Chat) => {
  const chatId = aiState.chatId
  const isSharePage = aiState.isSharePage
  return aiState.messages
    .map((message, index) => {
      const { role, content, id, type, name } = message

      if (
        !type ||
        type === 'end' ||
        (isSharePage && type === 'related') ||
        (isSharePage && type === 'followup')
      )
        return null

      switch (role) {
        case 'user':
          switch (type) {
            case 'input':
            case 'input_related':
              const json = JSON.parse(content)
              const value = type === 'input' ? json.input : json.related_query
              return {
                id,
                component: (
                  <UserMessage
                    message={value}
                    chatId={chatId}
                    showShare={index === 0 && !isSharePage}
                  />
                )
              }
            case 'inquiry':
              return {
                id,
                component: <CopilotDisplay content={content} />
              }
          }
        case 'assistant':
          const answer = createStreamableValue()
          answer.done(content)
          switch (type) {
            case 'answer':
              return {
                id,
                component: <AnswerSection result={answer.value} />
              }
            case 'related':
              const relatedQueries = createStreamableValue()
              relatedQueries.done(JSON.parse(content))
              return {
                id,
                component: (
                  <SearchRelated relatedQueries={relatedQueries.value} />
                )
              }
            case 'followup':
              return {
                id,
                component: (
                  <Section title="Follow-up" className="pb-8">
                    <FollowupPanel />
                  </Section>
                )
              }
          }
        case 'tool':
          try {
            const toolOutput = JSON.parse(content)
            const isCollapsed = createStreamableValue()
            isCollapsed.done(true)
            const searchResults = createStreamableValue()
            searchResults.done(JSON.stringify(toolOutput))
            switch (name) {
              case 'search':
                return {
                  id,
                  component: <SearchSection result={searchResults.value} />,
                  isCollapsed: isCollapsed.value
                }
              case 'retrieve':
                return {
                  id,
                  component: <RetrieveSection data={toolOutput} />,
                  isCollapsed: isCollapsed.value
                }
              case 'videoSearch':
                return {
                  id,
                  component: (
                    <VideoSearchSection result={searchResults.value} />
                  ),
                  isCollapsed: isCollapsed.value
                }
            }
          } catch (error) {
            return {
              id,
              component: null
            }
          }
        default:
          return {
            id,
            component: null
          }
      }
    })
    .filter(message => message !== null) as UIState
}
