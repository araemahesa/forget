import { Icon } from '../../design-system/Icon';

export function providerName(provider: string) {
  return ({ openai: 'OpenAI', anthropic: 'Claude', claude: 'Claude', gemini: 'Gemini', 'google-gemini': 'Gemini',
    'antigravity-9router': 'Antigravity · 9router', '9router': '9router', 'local-llm': 'Model lokal', 'openai-compatible': 'API kompatibel' } as Record<string, string>)[provider] ?? provider;
}
export function ProviderLogo({ provider }: { provider: string }) {
  const asset = provider === 'openai' ? 'openai' : ['anthropic', 'claude'].includes(provider) ? 'claude' : ['gemini', 'google-gemini'].includes(provider) ? 'gemini' : null;
  return <span aria-hidden="true" className={`provider-logo${asset ? ` is-${asset}` : ''}`}>
    {asset ? <img src={`/branding/providers/${asset}.svg`} alt="" /> : <Icon name={provider === 'local' || provider === 'local-llm' ? 'database' : 'link'} />}
  </span>;
}
