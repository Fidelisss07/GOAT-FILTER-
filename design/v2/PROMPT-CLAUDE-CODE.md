# Atualize a interface desktop do Goat Filter

Abra as quatro imagens em `telas/` e inspecione o código existente antes de editar. Refatore a camada visual do aplicativo Windows. Preserve a stack, os comandos nativos, os dados salvos, o funcionamento dos perfis, o alcance real de vibrância por monitor, o mecanismo de prévia e os atalhos configurados. Os screenshots são referências estáticas e não devem virar fundos clicáveis.

## Estrutura comum

Use `telas/01-visao-geral.png` como referência principal para a estrutura compartilhada. Crie uma única barra lateral e uma única moldura de janela para as quatro rotas. Em janela 1440 × 900, use lateral de ~220–230 px, barra de título de ~44 px e margens do conteúdo de 24–30 px. Barra de título grafite com separador neutro fino. Rosa, roxo ou amarelo aparecem no destaque ativo e nos controles. Remova do frame a antiga linha angular rosa.

Na lateral, monte a logo existente em linha, usando o símbolo e o lettering do SVG. Mostre Visão geral, Perfis, Desempenho e Configurações. O cabrito de perfil de `assets/arte/cabrito-lateral.png` é decorativo. Coloque-o entre o menu e o seletor de tema, ancorado perto da parte inferior da área livre, com baixa opacidade e sem capturar cliques. Reduza proporcionalmente em janelas baixas. Coloque Rosa, Roxo e Amarelo no rodapé da lateral e sincronize a escolha com Configurações e as preferências já salvas. Importe ou adapte `assets/tema/tokens.css` às convenções do projeto.

## Visão geral

Mostre a prévia Antes/Depois à esquerda e um painel contínuo à direita, na ordem Monitor, Vibrância e Perfil do Valorant. Preserve seleção de monitor, valor aplicado, restauração do padrão e switches de perfil. Use a cena de prévia existente. `assets/arte/cenario-preview.png` é um recurso alternativo, sem interface embutida. Preserve a escala 0/50/100/200 e os limites reais conforme o backend. Ajuste o divisor do comparador pelo controle já existente. Em janelas menores permita rolagem e reorganize o conteúdo antes de cortar controles.

## Perfis

Lista de perfis à esquerda, editor à direita. Preserve Novo perfil, nome, seleção de executável, vibrância, Aplicar ao abrir, Restaurar ao fechar e Salvar perfil. Renderize apenas os perfis disponíveis de fato. Os jogos adicionais visíveis no mockup são exemplos. Use o estado real de validação e seleção. Preserve a integração do perfil Valorant com Visão geral.

## Desempenho

Checklist de latência em primeiro plano, atalhos numa coluna menor. Dentro da interface, mostre os atalhos efetivamente registrados, incluindo todas as teclas da combinação. Referência de padrão: Ctrl + Alt + ↑, Ctrl + Alt + ↓, Ctrl + Alt + P. Mantenha a ação Voltar às teclas padrão. Exponha o estado real fornecido pelo app. Itens que são recomendações devem continuar identificados como tal.

## Configurações

Agrupe Aparência, Inicialização e Monitor e ajustes. Preserve os três temas, Iniciar com o Windows, Minimizar para a bandeja, Monitor padrão e Restaurar cores ao sair, ligados às preferências existentes.

## Validação

Compare capturas de todas as telas com os PNGs. Confira a navegação, troca e persistência dos três temas, foco por teclado, estado dos controles e redimensionamento. Execute o build e os testes existentes. Documente verificações nativas que exigirem um Windows com driver compatível. Preserve nomes, valores e funcionalidade reais se houver diferença de texto entre os mockups gerados e o app.
