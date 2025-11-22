import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, Sparkles } from 'lucide-react';
import { sendChatMessage, ChatMessage } from '../api';

const suggestedQuestions = [
  'What foods help with Vitamin D?',
  'How can I lower my cholesterol naturally?',
  'What supplements should I consider?',
  'Are my biomarkers concerning?',
];

export function DoctorAIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (message?: string) => {
    const messageToSend = message || input;
    if (!messageToSend.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: messageToSend,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await sendChatMessage(messageToSend);
      setMessages(prev => [...prev, response]);
    } catch (error) {
      console.error('Chat error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestedQuestion = (question: string) => {
    handleSend(question);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col h-full">
      <h2 className="text-xl font-bold text-green-400 mb-4 flex items-center gap-2">
        <MessageSquare className="w-5 h-5" />
        Doctor AI Chat
      </h2>

      {messages.length === 0 && (
        <div className="mb-4">
          <p className="text-slate-400 text-sm mb-3">Suggested questions:</p>
          <div className="grid grid-cols-1 gap-2">
            {suggestedQuestions.map((question, index) => (
              <button
                key={index}
                onClick={() => handleSuggestedQuestion(question)}
                className="text-left px-3 py-2 bg-slate-800/50 hover:bg-slate-800 text-slate-300 text-sm rounded-lg transition-colors border border-slate-700 hover:border-green-500/30"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto mb-4 space-y-4 min-h-0">
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.role === 'user'
                  ? 'bg-green-500 text-black'
                  : 'bg-slate-800 text-slate-200 border border-slate-700'
              }`}
            >
              {message.role === 'assistant' && (
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-green-400" />
                  <span className="text-xs text-green-400 font-semibold">
                    AI Doctor
                  </span>
                </div>
              )}
              <p className="text-sm">{message.content}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 border border-slate-700 p-3 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse delay-75" />
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse delay-150" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && handleSend()}
          placeholder="Ask about your results..."
          className="flex-1 px-4 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-green-500 transition-colors"
          disabled={isLoading}
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || isLoading}
          className="px-4 py-2 bg-green-500 text-black rounded-lg hover:bg-green-400 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed transition-all"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
