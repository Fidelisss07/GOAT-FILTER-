# Prompt principal para Claude Code

Implemente o Goat Filter, um utilitário Windows em português do Brasil para ajustar a intensidade das cores por monitor e ativar um perfil ao abrir o Valorant. Leia todos os PNGs em telas/ e os três prompts por tela desta pasta. Inspecione o repositório, preserve a stack e os componentes que já existirem. Se estiver vazio, use Tauri 2 + React + TypeScript para a interface Windows, com estado persistente local. Entregue uma aplicação executável em desenvolvimento e documente como testar.

## Fidelidade visual

Use telas/01-visao-geral-roxo.png como referência de geometria. Em 1672×941 a sidebar tem cerca de 314 px e o conteúdo começa em x=340, com margem direita de cerca de 22 px. A linha de controles em y≈140–450 tem duas colunas, cerca de 2:1 com 20 px de intervalo. A prévia começa em y≈476. Adapte proporções para uma janela 1280×800. Em larguras menores empilhe os dois cartões superiores antes de causar overflow. Use CSS Grid/Flexbox e reserve espaço para os controles de janela. Títulos e controles usam Inter ou Segoe UI. Use o SVG da marca, sem redesenhar a tipografia. No topo da sidebar, posicione o SVG completo em linha se houver espaço, usando o símbolo separado e o wordmark extraído do SVG quando necessário para reproduzir a disposição horizontal da referência.

Use tokens globais: fundo #111118, superfície #191922, borda #3B3B48, texto #F4F4FA, texto secundário #BBBBCA. Temas roxo #AD78FF, rosa #FF48A8 e amarelo #FFD629. Use o acento para logo, trilho preenchido, valor, botão Aplicar, navegação ativa, toggles, divisor e cantos chanfrados. Use texto escuro nos botões sólidos e verifique contraste nos estados inativo, hover e foco. Os PNGs mostram intensidade aproximada, os hexadecimais definem os tokens. O seletor mantém a ordem rosa, roxo, amarelo, com foco visível, nome acessível e marca de seleção. Persista o tema e aplique imediatamente em todas as páginas.

Implemente a interface com componentes reais. Use os SVGs em logos/ como assets e as capturas apenas para comparar visualmente. As abas são Visão geral, Perfis e Configurações. Navegação, slider, seleção de monitor, formulários, toggles e seletor de tema devem funcionar com mouse e teclado. Use a paleta ativa também nas páginas internas.

## Integração Windows

Separe estado da interface e acesso à GPU em um adaptador por monitor. Consulte o mecanismo de ajuste efetivamente disponível antes de habilitar Aplicar. Preserve o valor anterior para restauração, trate monitor desconectado, erros do driver e mudança de monitor. Com hardware sem suporte ou em prévia, mostre o estado com clareza. Use detecção local do processo configurado e ajustes de exibição suportados pelo sistema/driver. Evite que alterações de tema mudem configurações de exibição. Não confunda a prévia CSS com ajuste aplicado na GPU.

## Verificação

Execute build, verificação de tipos e testes existentes. Abra cada uma das três páginas e confira os três temas, a persistência após reinício, o divisor antes/depois e a navegação por teclado. Compare capturas com os mockups. Registre o que foi validado em um Windows com GPU compatível e o que depende de hardware.
