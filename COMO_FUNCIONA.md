# Como funciona

Resumo para estudar antes de uma entrevista técnica.

## 1. O fluxo

```
Todo dia às 8h ─┐
Executar agora ─┴→ Definir buscas → Buscar vagas na Gupy → Filtrar vagas novas → Checar golpe → Montar resumo → Enviar resumo por e-mail
```

O gatilho **Executar agora** (Manual Trigger) é a segunda entrada. Serve para testar no n8n e é exigido pelo `n8n execute` na linha de comando, que não dispara um Schedule Trigger.

| Nó | Tipo | O que faz |
|---|---|---|
| Todo dia às 8h | Schedule Trigger | dispara pelo cron `0 8 * * *` no fuso de Fortaleza, o mesmo de Mossoró |
| Definir buscas | Code | guarda a configuração e gera uma URL de busca por termo e local (4 termos × 2 locais = 8 buscas) |
| Buscar vagas na Gupy | HTTP Request | chama a API pública da Gupy uma vez para cada item que chega |
| Filtrar vagas novas | Code | junta as 8 respostas, tira repetidas, filtra local e data e prepara o lote para o detector |
| Checar golpe | HTTP Request | `POST /analyze` na API do detector, com todas as vagas de uma vez |
| Montar resumo | Code | cruza o veredito com os dados da vaga e monta o HTML do e-mail |
| Enviar resumo por e-mail | Send Email | manda por SMTP: Mailpit nos testes, Gmail de verdade |

## 2. Conceitos do n8n que aparecem aqui

- **Item**: cada pacote de dados que passa entre nós. Um nó roda uma vez por item que recebe; por isso as 8 URLs viram 8 chamadas na Gupy sem nenhum laço escrito.
- **Code node**: JavaScript com `$input.all()` (todos os itens de entrada) e `$('Nome do nó')` (dados de um nó anterior).
- **Expressão**: o texto entre `{{ }}` nos campos, como `{{ $json.url }}`, que é calculado na hora para cada item.
- **Credencial**: senha e servidor SMTP ficam guardados criptografados no n8n. O workflow só guarda o **id** da credencial, por isso o arquivo pode ir para o GitHub.
- **Retornar lista vazia** num Code node para o fluxo ali. É assim que não chega e-mail em dia sem vaga nova.

## 3. Decisões de projeto

- **Lote para o detector, não vaga por vaga.** O detector compara as vagas entre si para achar texto copiado com cargo diferente (sinal A2). Mandar uma por vez perderia esse sinal e faria dezenas de chamadas.
- **Duas buscas por termo** (remoto e Mossoró) em vez de uma busca geral filtrada depois. A API da Gupy ordena por relevância e limita a 100 resultados. Uma busca geral enterraria as poucas vagas de Mossoró no meio das de São Paulo.
- **Filtro de local repetido no código**, mesmo com a busca já filtrada. A regra "só remoto ou Mossoró" fica garantida no código, sem depender de como a API interpreta cada filtro.
- **Comparação de cidade sem acento e sem maiúsculas**, porque "Mossoró" e "mossoro" aparecem nos dados.
- **Escape do HTML.** Título e empresa vêm de fora; sem escape, um título com `<script>` ou um link `javascript:` iria parar no e-mail. Só links `https://` viram link.
- **Mailpit no compose** para testar o fluxo inteiro sem conta de e-mail e sem senha.
- **Import automático só na primeira subida.** O arquivo `.imported` no volume evita que um restart sobrescreva a credencial que você escolheu no nó.
- **Detector construído direto do GitHub.** O `build:` do compose aponta para o repositório do outro projeto, então não há cópia de código entre os dois.

## 4. Testes

O jeito comum de testar n8n é clicar em "Execute" e olhar. Aqui a lógica dos Code nodes também roda fora do n8n:
1. o teste lê o `jsCode` do JSON exportado;
2. cria versões mínimas de `$input` e `$(...)`;
3. executa o código com dados inventados.

Assim, se alguém editar o nó no n8n e exportar de novo, o teste roda sobre o código novo.

Também verifica a estrutura: todo nó tem entrada, nenhuma ligação aponta para nó inexistente, e o arquivo não tem senha nem e-mail real.

## 5. Perguntas prováveis

**Por que n8n e não um script Python com cron?**
O n8n mostra cada execução com os dados de cada nó, o que facilita achar onde falhou. Também deixa outra pessoa mudar termos e destino sem programar. A parte que precisa de código de verdade, o detector, ficou em Python com testes.

**E se a Gupy mudar a API?**
O nó de busca falha e a execução aparece com erro no n8n. Dá para configurar um "Error Workflow" que avisa por e-mail. A URL e o formato esperado estão concentrados em dois nós.

**Como escalaria para muitos usuários?**
- Cada usuário com seus termos numa tabela (Data Table do n8n ou planilha).
- Um sub-workflow por usuário.
- Cache das buscas repetidas entre usuários.

**Qual foi o papel da IA?**
Eu defini o que precisava (termos, locais, janela de 24 h, descartar golpe). O Claude Code ajudou a montar os nós, o compose e os testes. O fluxo rodou de ponta a ponta no Docker: 8 buscas na Gupy, filtro, detector e e-mail entregue no Mailpit.
