# IdeaGold 3.0 — Mineração em 1 Clique

Versão simplificada para Windows e para o perfil SNIPER (i5-4670K, RX 460 4 GB, energia R$ 0,90/kWh).

## Uso

1. Dê dois cliques em `INICIAR_IDEAGOLD.bat`.
2. Aceite a janela de Administrador.
3. O navegador abre sozinho.
4. Cole seu **endereço público XMR**.
5. Clique em **Salvar carteira**.
6. Clique em **INSTALAR E COMEÇAR**.

Na primeira execução, o IdeaGold baixa XMRig 6.26.0 **do repositório oficial `xmrig/xmrig`** e verifica SHA-256 antes de extrair ou executar:

`bba8097cb37d9b458a1cb1137876b27cde6740d17fe4ccbc086ba07d87d9e147`

Se o hash não for idêntico, a instalação é abortada.

## Carteira

O IdeaGold só armazena o endereço público de recebimento. **Nunca cole seed phrase, chave privada ou senha.**

Para iniciantes, a Monero GUI oficial em modo simples é uma opção direta:
- crie a carteira;
- anote a seed em local seguro;
- abra `Receber`;
- copie o endereço;
- cole no IdeaGold.

A mineração é enviada ao MoneroOcean por TLS. O pool acumula o saldo e faz pagamentos para o endereço informado conforme suas regras/payout configurado.

## Por que 3 threads?

O i5-4670K tem 6 MB de cache L3. RandomX usa aproximadamente 2 MB de cache por thread; `6 / 2 = 3`, então o perfil começa em 3 threads. O usuário ainda pode comparar 2–4 na área avançada.

## GoldBrain

A V3 inclui:
- leitura de hashrate/shares pela API local do XMRig;
- Huge Pages/MSR;
- cotação XMR/BRL;
- consulta ao pool quando disponível;
- Monte Carlo de risco para mostrar incerteza de rentabilidade;
- controle local-only de instalar/iniciar/parar;
- verificação criptográfica SHA-256 do binário do minerador.

Monte Carlo e qualquer outro cálculo **não aumentam a quantidade física de hashes**. Eles ajudam a escolher melhor e a evitar prejuízo. Não existe “matemática quântica” prática que transforme este i5 em hardware de mineração mais rápido.

## Segurança

- servidor padrão: `127.0.0.1`;
- endpoints que iniciam/pararam o minerador aceitam apenas chamadas locais;
- trading automático não faz parte da tela simples;
- o minerador não inicia escondido no boot;
- não desative antivírus para instalar binários desconhecidos.

XMRig pode ser classificado por alguns antivírus como software de mineração/PUA por sua função. O IdeaGold usa release oficial e checa o hash antes de executar.
