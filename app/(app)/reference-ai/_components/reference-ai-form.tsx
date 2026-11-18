'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

type Insight = {
  resumo: string;
  publicoHipotetico: string[];
  ideiasConteudo: string[];
  ressalva: string;
  referenceUsername: string;
  followersIdentified: false;
  realSocialActions: 0;
};

export function ReferenceAIForm() {
  const [referenceUsername, setReferenceUsername] = useState('');
  const [bioPublica, setBioPublica] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Insight | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent) {
      toast.error('Confirme o envio dos textos públicos à OpenAI.');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch('/api/ai/reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceUsername, bioPublica, objetivo, consent }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a análise.');
      if (data.followersIdentified !== false || data.realSocialActions !== 0) {
        throw new Error('Resposta inesperada do assistente.');
      }
      setResult(data as Insight);
      toast.success('Análise recebida. Nenhuma interação no Instagram foi executada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro na análise.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>IA para contas de referência</CardTitle>
          <CardDescription>
            Experimento com GPT sem exigir conexão Meta. A análise não descobre
            seguidores de outras contas nem executa follow, mensagens ou comentários.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reference-username">Perfil de referência</Label>
              <Input
                id="reference-username"
                placeholder="mameto_lueji"
                maxLength={31}
                required
                value={referenceUsername}
                onChange={event => setReferenceUsername(event.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Digite o @ da referência, sem vínculo com a API Meta.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference-bio">Informações públicas sobre a referência (opcional)</Label>
              <textarea
                id="reference-bio"
                className="w-full min-h-24 rounded-md border bg-background p-3 text-sm"
                maxLength={700}
                value={bioPublica}
                placeholder="Por exemplo: conteúdos públicos sobre tarô, consultas e espiritualidade."
                onChange={event => setBioPublica(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference-objective">Qual é seu objetivo?</Label>
              <Input
                id="reference-objective"
                maxLength={250}
                required
                value={objetivo}
                placeholder="Criar conteúdo original para atrair interessados em consultas de tarô"
                onChange={event => setObjetivo(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={consent}
                onChange={event => setConsent(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>Autorizo o envio desses textos à API OpenAI para uma análise paga.
                Não incluí senhas, dados privados ou listas de pessoas.</span>
            </label>
            <Button type="submit" disabled={loading || !referenceUsername.trim() || !objetivo.trim() || !consent}>
              {loading ? 'Analisando...' : 'Analisar referência com GPT'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Disponível apenas no Preview experimental. Uma análise pode consumir
              créditos da API. Os limites do teste são provisórios; configure
              orçamento no projeto OpenAI antes de liberar para outras pessoas.
            </p>
          </form>
        </CardContent>
      </Card>
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Estratégias de conteúdo com referência @{result.referenceUsername}</CardTitle>
            <CardDescription>
              Estas sugestões são para o seu objetivo. O GPT não verificou o perfil
              @{result.referenceUsername}, seus conteúdos ou seus seguidores.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">{result.resumo}</p>
            <div className="space-y-2">
              <h3 className="font-semibold">Possíveis interesses do público</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {result.publicoHipotetico.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Ideias de conteúdo</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {result.ideiasConteudo.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">{result.ressalva}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
