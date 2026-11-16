# Visão geral — três temas

Abra telas/01-visao-geral-roxo.png, 02-visao-geral-rosa.png e 03-visao-geral-amarelo.png. Implemente uma única tela com variação via tokens, mantendo proporções e posições entre as três versões.

- Cabeçalho Digital Vibrance. Cartão à esquerda com Monitor, seletor Monitor principal, valor 75% no estado de demonstração, slider inteiro 0–100 com marcas 0%, 50% e 100%, Aplicar e Restaurar padrão.
- Diferencie valor editado de valor aplicado. Restaurar padrão usa o valor padrão definido pelo driver quando disponível. Se o driver não expuser esse valor, mostre a limitação e ofereça restaurar o valor anterior com esse nome. Alterações de perfil usam suas próprias regras.
- Cartão à direita Perfil do Valorant, com Aplicar ao abrir e Restaurar ao fechar. Mostre o estado real da integração caso indisponível.
- Painel inferior Antes/Depois. Use assets/cenario-preview.png para ambos os lados, com o mesmo recorte e alinhamento. Use camadas sobrepostas, CSS saturation e clip-path no divisor, com cursor de arraste e controle por teclado. Inicialize no meio. A cena é ilustrativa e não mede o ajuste real do monitor.
- Confira: clique e arraste no slider, troca de monitor, feedback de aplicar/restaurar, arraste do comparador e manutenção do estado ao trocar tema.
