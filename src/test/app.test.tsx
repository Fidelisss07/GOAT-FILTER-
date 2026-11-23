import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import { createDemoApi, setNativeForTests } from "../lib/native";
import { matrixFactor } from "../lib/vibrance";
import { cmPer360, convertSens } from "../lib/sens";
import { bitrateKbps, formatClock, outputSize } from "../lib/rec";
import { xrayItems, xrayScore } from "../lib/xray";
import { CROSSHAIR_PRESETS, crosshairRects, parseCrosshair, primaryValues } from "../lib/crosshair";
import { decodeProfile, encodeProfile } from "../lib/profileCode";
import { dailyBest, streak, TrainResult } from "../lib/trainStats";
import { DEFAULT_SETTINGS } from "../lib/types";
import { isCrosshairCode } from "../lib/types";
import { bindingFromEvent, prettyBinding } from "../components/KeyCapture";
import { useStore } from "../state/store";

const initial = useStore.getState();

async function renderApp() {
  render(<App />);
  await screen.findByText("Perfil do Valorant");
}

beforeEach(() => {
  localStorage.clear();
  setNativeForTests(createDemoApi());
  useStore.setState(initial, true);
});

describe("Visão geral", () => {
  it("slider responde ao teclado e marca alteração pendente", async () => {
    await renderApp();
    const slider = screen.getByRole("slider", { name: "Digital Vibrance" });
    expect(slider).toHaveAttribute("aria-valuenow", "75");
    expect(slider).toHaveAttribute("aria-valuemax", "200");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider).toHaveAttribute("aria-valuenow", "86");
    expect(screen.getByText(/alteração pendente/)).toBeInTheDocument();
  });

  it("aplicar mostra o valor aplicado", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(await screen.findByText("Aplicado: 75%", { selector: ".toast" })).toBeInTheDocument();
  });

  it("restaurar padrão volta para 50%", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Restaurar padrão" }));
    expect(screen.getByRole("slider", { name: "Digital Vibrance" })).toHaveAttribute("aria-valuenow", "50");
  });

  it("divisor antes/depois começa no meio e anda pelo teclado", async () => {
    await renderApp();
    const div = screen.getByRole("slider", { name: /Divisor/ });
    expect(div).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(div, { key: "ArrowLeft" });
    expect(div).toHaveAttribute("aria-valuenow", "48");
  });
});

describe("Tema", () => {
  it("troca, persiste e não altera o slider", async () => {
    await renderApp();
    const slider = screen.getByRole("slider", { name: "Digital Vibrance" });
    fireEvent.keyDown(slider, { key: "End" });
    await userEvent.click(screen.getByRole("radio", { name: "Tema Amarelo" }));
    expect(document.documentElement.dataset.theme).toBe("amarelo");
    expect(slider).toHaveAttribute("aria-valuenow", "200");
    expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).theme).toBe("amarelo");
  });
});

describe("Perfis", () => {
  it("valida nome vazio e caminho inválido, depois salva", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Perfis" }));
    await userEvent.click(screen.getByRole("button", { name: "Novo perfil" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    expect(screen.getByText("Informe um nome para o perfil.")).toBeInTheDocument();
    expect(screen.getByText("Informe o executável do jogo.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Nome do perfil"), "CS2");
    await userEvent.type(screen.getByLabelText("Executável"), "C:\\Jogos\\cs2.txt");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    expect(screen.getByText("O caminho precisa terminar em .exe.")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Executável"));
    await userEvent.type(screen.getByLabelText("Executável"), "C:\\Jogos\\cs2.exe");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    const list = screen.getByRole("region", { name: "Meus perfis" });
    expect(await within(list).findByText("CS2")).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem("goat-filter:settings")!);
    expect(saved.profiles.map((p: { name: string }) => p.name)).toEqual(["Valorant", "CS2"]);
  });

  it("toggle do Valorant na visão geral reflete no editor", async () => {
    await renderApp();
    await userEvent.click(screen.getAllByRole("switch", { name: "Aplicar ao abrir" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "Perfis" }));
    expect(screen.getByRole("switch", { name: "Aplicar ao abrir" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("Ajustes finos", () => {
  it("realce, gama e foco são salvos no perfil e testados no monitor", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Perfis" }));
    await userEvent.click(screen.getByText("Ajustes finos"));
    await userEvent.click(screen.getByRole("radio", { name: /Vermelho/ }));
    const gamma = screen.getByRole("slider", { name: "Gama" });
    fireEvent.keyDown(gamma, { key: "PageUp" });
    fireEvent.keyDown(gamma, { key: "PageUp" });
    await userEvent.click(screen.getByRole("switch", { name: "Só com o jogo em foco" }));
    await userEvent.click(screen.getByRole("button", { name: "Testar agora" }));
    const mon = useStore.getState().monitors.find((m) => m.primary)!;
    expect(mon.tuning.gamma).toBe(120);
    expect(mon.tuning.emphasis).toBe("red");

    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    const saved = JSON.parse(localStorage.getItem("goat-filter:settings")!).profiles[0];
    expect(saved.tuning).toMatchObject({ emphasis: "red", gamma: 120 });
    expect(saved.focusOnly).toBe(true);
  });
});

describe("Monitor pelo cabo (DDC/CI)", () => {
  it("lê o monitor, mostra o que não é suportado e salva o brilho", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Perfis" }));
    await userEvent.click(screen.getByText("Ajustes finos"));
    const brightness = await screen.findByRole("checkbox", { name: "Brilho do monitor" });
    expect(screen.getByText("não suportado")).toBeInTheDocument(); // saturação do monitor
    await userEvent.click(brightness);
    const slider = screen.getByRole("slider", { name: "Brilho do monitor" });
    expect(slider).toHaveAttribute("aria-valuenow", "70");
    fireEvent.keyDown(slider, { key: "End" });
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    const saved = JSON.parse(localStorage.getItem("goat-filter:settings")!).profiles[0];
    expect(saved.tuning.monitorBrightness).toBe(100);
    expect(saved.tuning.monitorContrast).toBeNull();
  });
});

describe("Desempenho", () => {
  it("liga ajustes de mouse/energia e salva", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Desempenho" }));
    expect(await screen.findByText("agora: ligada")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Desligar aceleração do mouse" }));
    await userEvent.click(screen.getByRole("switch", { name: "Plano de energia Alto desempenho" }));
    const saved = JSON.parse(localStorage.getItem("goat-filter:settings")!);
    expect(saved.perf).toEqual({ mouseAccelOff: true, keyboardFast: false, highPerformancePower: true });
  });

  it("troca a tecla de um atalho e avisa conflito", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Desempenho" }));
    const toggle = screen.getByRole("button", { name: /Ligar \/ desligar o filtro/ });
    await userEvent.click(toggle);
    expect(toggle).toHaveTextContent("Aperte a combinação");
    fireEvent.keyDown(toggle, { code: "KeyH", ctrlKey: false, altKey: false });
    expect(screen.getByText("Use Ctrl ou Alt junto com a tecla.")).toBeInTheDocument();
    fireEvent.keyDown(toggle, { code: "KeyP", ctrlKey: true, altKey: true });
    expect(toggle).toHaveTextContent("Ctrl + Alt + P");
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("goat-filter:settings") ?? "{}").bindings?.toggle).toBe("Ctrl+Alt+KeyP"),
    );
    expect(screen.getAllByText(/Mesma tecla de/).length).toBe(2);
    await userEvent.click(screen.getByRole("button", { name: "Voltar às teclas padrão" }));
    expect(screen.queryByText(/Mesma tecla de/)).toBeNull();
  });

  it("liga o Modo de Jogo do Windows", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Desempenho" }));
    const row = (await screen.findByText("Modo de Jogo do Windows", { selector: ".row span" })).closest(".row") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Ligar" }));
    expect(await screen.findByText("Ligado", { selector: ".state" })).toBeInTheDocument();
  });

  it("formato das teclas", () => {
    expect(bindingFromEvent({ code: "KeyG", ctrlKey: true, altKey: true, shiftKey: false })).toBe("Ctrl+Alt+KeyG");
    expect(bindingFromEvent({ code: "F5", ctrlKey: false, altKey: true, shiftKey: true })).toBe("Alt+Shift+F5");
    expect(bindingFromEvent({ code: "KeyW", ctrlKey: false, altKey: false, shiftKey: false })).toBeNull();
    expect(bindingFromEvent({ code: "ControlLeft", ctrlKey: true, altKey: false, shiftKey: false })).toBeNull();
    expect(prettyBinding("Ctrl+Alt+ArrowUp")).toBe("Ctrl + Alt + ↑");
    // Atalhos de gravação: tecla sozinha só se não atrapalhar o jogo/chat.
    expect(bindingFromEvent({ code: "F8", ctrlKey: false, altKey: false, shiftKey: false }, true)).toBe("F8");
    expect(bindingFromEvent({ code: "Numpad0", ctrlKey: false, altKey: false, shiftKey: false }, true)).toBe("Numpad0");
    expect(bindingFromEvent({ code: "Insert", ctrlKey: false, altKey: false, shiftKey: true }, true)).toBe("Shift+Insert");
    expect(bindingFromEvent({ code: "KeyC", ctrlKey: false, altKey: false, shiftKey: false }, true)).toBeNull();
    expect(bindingFromEvent({ code: "Space", ctrlKey: false, altKey: false, shiftKey: false }, true)).toBeNull();
    expect(bindingFromEvent({ code: "NumpadEnter", ctrlKey: false, altKey: false, shiftKey: false }, true)).toBeNull();
    expect(bindingFromEvent({ code: "F8", ctrlKey: false, altKey: false, shiftKey: false })).toBeNull();
    expect(prettyBinding("F8")).toBe("F8");
    expect(prettyBinding("Numpad0")).toBe("Num 0");
  });
});

describe("v1.4", () => {
  it("preset Competitivo preenche vibrance e realce", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Perfis" }));
    const comp = screen.getByRole("button", { name: "Competitivo" });
    await userEvent.click(comp);
    expect(comp).toHaveAttribute("aria-pressed", "true");
    const d = useStore.getState().draft!;
    expect(d.vibrance).toBe(90);
    expect(d.tuning).toMatchObject({ emphasis: "red", gamma: 120 });
  });

  it("encontra jogos instalados e cria perfis", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Perfis" }));
    await userEvent.click(screen.getByRole("button", { name: "Encontrar jogos instalados" }));
    const panel = await screen.findByRole("region", { name: "Jogos instalados" });
    // Valorant já tem perfil: não aparece
    expect(within(panel).queryByText("Valorant")).toBeNull();
    expect(within(panel).getByText("Steam")).toBeInTheDocument();
    expect(within(panel).getByText("2 jogos encontrados sem perfil.")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Adicionar todos (2)" }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("goat-filter:settings") ?? "{}");
      expect(saved.profiles?.map((p: { id: string }) => p.id)).toEqual(["valorant", "cs2", "fortnite"]);
    });
  });

  it("troca o idioma para inglês", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Configurações" }));
    await userEvent.selectOptions(screen.getByLabelText("Idioma"), "en");
    expect(await screen.findByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).language).toBe("en");
  });

  it("opção de todos os monitores e avisos são salvas", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Configurações" }));
    await userEvent.click(screen.getByRole("switch", { name: "Aplicar perfis em todos os monitores" }));
    await userEvent.click(screen.getByRole("switch", { name: "Avisar quando um perfil ligar ou desligar" }));
    const saved = JSON.parse(localStorage.getItem("goat-filter:settings")!);
    expect(saved.applyAllMonitors).toBe(true);
    expect(saved.notify).toBe(false);
  });
});

describe("Desempenho v1.5", () => {
  it("corrige a taxa do monitor, desliga o Game DVR e escolhe apps para fechar", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Desempenho" }));
    expect(await screen.findByText("60 Hz de 144 Hz")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Usar 144 Hz" }));
    expect((await screen.findAllByText("144 Hz")).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Desligar" }));
    expect(await screen.findByText("Desligada")).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("checkbox", { name: /Google Chrome/ }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("goat-filter:settings") ?? "{}").closeOnGame).toEqual(["chrome.exe"]),
    );
    expect(await screen.findByText("NVIDIA GeForce RTX 3090")).toBeInTheDocument();
  });
});

describe("Atualização dentro do app", () => {
  it("mostra o aviso no topo e atualiza sem abrir página", async () => {
    const api = createDemoApi();
    let called = 0;
    api.updateNow = async () => {
      called++;
    };
    api.updaterState = async () => ({ pending: null, installed: true });
    setNativeForTests(api);
    await renderApp();
    act(() =>
      useStore.setState({
        update: { current: "1.3.0", latest: "v1.4.0", available: true, url: null, notes: "presets\njogos" },
      }),
    );
    const banner = await screen.findByText("Nova versão v1.4.0 disponível");
    expect(banner).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Atualizar agora" }));
    expect(called).toBe(1);
    act(() => useStore.setState({ updateProgress: 42 }));
    expect(screen.getByText("Baixando… 42%")).toBeInTheDocument();
    act(() => useStore.setState({ updateProgress: null }));
    await userEvent.click(screen.getByRole("button", { name: "Mais tarde" }));
    expect(screen.queryByText("Nova versão v1.4.0 disponível")).toBeNull();
  });
});

describe("Treino v1.6", () => {
  it("conversor de sensibilidade: CS2 1.5 → Valorant ≈ 0.471", () => {
    expect(convertSens(1.5, "cs2", "valorant")).toBeCloseTo(0.4714, 3);
    expect(convertSens(0.4714, "valorant", "cs2")).toBeCloseTo(1.5, 2);
    expect(cmPer360(0.4714, 800, "valorant")).toBeCloseTo(34.6, 0);
  });

  it("valida código de mira do Valorant", () => {
    expect(isCrosshairCode("0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0")).toBe(true);
    expect(isCrosshairCode("oi")).toBe(false);
    expect(isCrosshairCode("0;P;<script>")).toBe(false);
  });

  it("abre a aba Treino, salva uma mira e mostra o conversor", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Treino" }));
    expect(screen.getByRole("button", { name: "Aquecer e jogar" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Miras" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByText("Dê um nome para a mira.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nome"), "Minha");
    await userEvent.type(screen.getByLabelText("Código da mira"), "0;P;c;5;h;0;0l;4");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Minha")).toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).crosshairs[0].code).toBe("0;P;c;5;h;0;0l;4"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Excluir Minha" }));
    expect(screen.queryByText("Minha")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Sensibilidade" }));
    await userEvent.click(screen.getByRole("button", { name: "Abrir Sensibilidade" }));
    expect(screen.getByRole("heading", { level: 1, name: "Sensibilidade" })).toBeInTheDocument();
    expect(screen.getByText("0.471")).toBeInTheDocument();
  });

  it("aba Sensibilidade: salva a minha, mostra eDPI e abre o teste", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Sensibilidade" }));
    const mine = screen.getByRole("region", { name: "Minha sensibilidade" });
    const dpi = within(mine).getByLabelText("DPI");
    const sens = within(mine).getByLabelText("Sensibilidade no Valorant");
    await userEvent.clear(dpi);
    await userEvent.type(dpi, "1600");
    await userEvent.clear(sens);
    await userEvent.type(sens, "0.2");
    expect(within(mine).getByText("320")).toBeInTheDocument();
    expect(within(mine).getByText("Média (como a maioria dos pros)")).toBeInTheDocument();
    await userEvent.click(within(mine).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("goat-filter:sens")!).sens).toBe(0.2));
    const swap = screen.getByRole("region", { name: "Trocar de DPI sem mudar a mira" });
    await userEvent.clear(within(swap).getByLabelText("DPI novo"));
    await userEvent.type(within(swap).getByLabelText("DPI novo"), "800");
    expect(within(swap).getByText("0.4")).toBeInTheDocument();
    const finder = screen.getByRole("region", { name: "Descobrir minha sensibilidade" });
    await userEvent.click(within(finder).getByRole("button", { name: "Começar" }));
    expect(within(finder).getByText("Rodada 1 de 5")).toBeInTheDocument();
    expect(within(finder).getByRole("button", { name: "Começar teste A" })).toBeInTheDocument();
  });

  it("teste de reação avisa clique cedo demais", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Treino" }));
    await userEvent.click(screen.getByRole("tab", { name: "Reação" }));
    const btn = screen.getByRole("button", { name: /Clique para começar/ });
    fireEvent.mouseDown(btn);
    expect(screen.getByText("Espere o verde…")).toBeInTheDocument();
    fireEvent.mouseDown(btn);
    expect(screen.getByText(/Cedo demais/)).toBeInTheDocument();
  });
});

describe("Gravação v1.7", () => {
  it("mesmas contas do núcleo em Rust", () => {
    expect(outputSize(2560, 1440, 1080)).toEqual([1920, 1080]);
    expect(outputSize(3840, 2160, 1440)).toEqual([2560, 1440]);
    expect(outputSize(1366, 768, 720)).toEqual([1280, 720]);
    expect(outputSize(1365, 767, 1080)).toEqual([1364, 766]);
    expect(bitrateKbps(1920, 1080, 60, "balanced")).toBe(16000);
    expect(bitrateKbps(3840, 2160, 60, "high")).toBe(60000);
    expect(formatClock(75)).toBe("01:15");
    expect(formatClock(3725)).toBe("1:02:05");
  });

  it("liga o replay, salva um clipe e grava gameplay", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Gravação" }));
    const save30 = await screen.findByRole("button", { name: "Últimos 30s" });
    expect(save30).toBeDisabled();

    const replayRow = screen.getAllByText("Replay instantâneo").find((el) => el.closest(".row"))!.closest(".row") as HTMLElement;
    await userEvent.click(within(replayRow).getByRole("switch"));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).recorder.replay).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Últimos 30s" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Últimos 30s" }));
    expect(await screen.findByText(/Clipe salvo: Clipe 30s 1\.mp4/, { selector: ".toast" })).toBeInTheDocument();
    expect(await screen.findByText("Clipe 30s 1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "1440p (2K)" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).recorder.maxHeight).toBe(1440));

    await userEvent.click(screen.getByRole("button", { name: "Começar a gravar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Parar e salvar" }));
    expect(await screen.findByText(/Gravação salva: Gameplay 2\.mp4/, { selector: ".toast" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Excluir Gameplay 2.mp4" }));
    await waitFor(() => expect(screen.queryByText("Gameplay 2")).not.toBeInTheDocument());
  });
});

describe("Clipes v1.8", () => {
  it("favorita, edita (corte, vertical, comprimir) e renomeia", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Gravação" }));
    const replayRow = screen.getAllByText("Replay instantâneo").find((el) => el.closest(".row"))!.closest(".row") as HTMLElement;
    await userEvent.click(within(replayRow).getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Últimos 20s" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Últimos 20s" }));
    await screen.findByText("Clipe 20s 1");

    await userEvent.click(screen.getByRole("button", { name: "Favoritar" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).recorder.favorites).toEqual(["Clipe 20s 1.mp4"]));
    expect(screen.getByRole("button", { name: "Tirar dos favoritos" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    const dlg = await screen.findByRole("dialog", { name: "Editar clipe" });
    await userEvent.click(within(dlg).getByRole("button", { name: "Vertical (TikTok, Reels, Shorts)" }));
    expect(await screen.findByText(/Vertical salvo: Clipe 20s 1 \(vertical\)\.mp4/, { selector: ".toast" })).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Comprimir 10 MB (Discord)" }));
    expect(await screen.findByText(/Versão de 10 MB salva/, { selector: ".toast" })).toBeInTheDocument();
    // Sem webhook, sem botão do Discord.
    expect(within(dlg).queryByRole("button", { name: "Enviar para o Discord" })).not.toBeInTheDocument();

    const name = within(dlg).getByLabelText("Nome");
    await userEvent.clear(name);
    await userEvent.type(name, "Ace no Ascent");
    await userEvent.click(within(dlg).getByRole("button", { name: "Renomear" }));
    expect(await screen.findByText("Ace no Ascent")).toBeInTheDocument();
  });

  it("webhook do Discord valida o link e marcador só grava durante a gravação", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Gravação" }));
    const hook = screen.getByLabelText("Webhook do Discord (opcional)");
    await userEvent.type(hook, "https://site.com/x");
    expect(screen.getByText(/Cole o link do webhook/)).toBeInTheDocument();
    await userEvent.clear(hook);
    await userEvent.type(hook, "https://discord.com/api/webhooks/123456789/abcdefghijk");
    await userEvent.click(within(hook.closest(".hook-row") as HTMLElement).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).recorder.discordWebhook).toBe("https://discord.com/api/webhooks/123456789/abcdefghijk"),
    );
    await userEvent.selectOptions(screen.getByLabelText("Apagar clipes antigos"), "30");
    await waitFor(() => expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).recorder.keepDays).toBe(30));
  });

  it("botão lateral do mouse vira atalho de clipe", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Gravação" }));
    const key = screen.getByRole("button", { name: /Salvar clipe: Alt \+ F8/ });
    await userEvent.click(key);
    fireEvent.mouseDown(key, { button: 3 });
    await waitFor(() => expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).bindings.saveClip).toBe("Mouse4"));
    expect(screen.getByRole("button", { name: /Salvar clipe: Mouse 4/ })).toBeInTheDocument();
  });
});

describe("Desempenho+ v1.9", () => {
  it("nota do Raio-X só conta o que dá para medir", () => {
    const base = { modes: null, tweaks: null, perf: null, settings: DEFAULT_SETTINGS };
    expect(xrayScore(xrayItems(base))).toBe(0); // só "apps pesados" conhecido e falso
    const items = xrayItems({
      modes: [{ monitorId: "a", name: "M", mode: { width: 1920, height: 1080, hz: 144, maxHz: 144, rates: [60, 144] } }],
      tweaks: { gameDvr: false, hags: true },
      perf: { supported: true, mouseAccel: false, keyboardDelay: 0, keyboardSpeed: 31, powerHigh: true, gameMode: true, applied: false },
      settings: { ...DEFAULT_SETTINGS, closeOnGame: ["chrome.exe"] },
    });
    expect(xrayScore(items)).toBe(100);
    expect(xrayScore([])).toBeNull();
  });

  it("mostra Raio-X, limpa cache e salva o aviso de temperatura", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Desempenho" }));
    expect(await screen.findByRole("img", { name: /Nota \d+ de 100/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver quanto dá para limpar" }));
    const clean = await screen.findByRole("button", { name: /Limpar 1\.6 GB/ });
    await userEvent.click(clean);
    expect(await screen.findByText("1.6 GB liberados.", { selector: ".toast" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Avisar se a GPU passar de"), "80");
    await waitFor(() => expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).tempAlert).toBe(80));
    expect(screen.getByText("Sua semana")).toBeInTheDocument();
    expect(screen.getByText("5h45")).toBeInTheDocument();
  });
});

describe("Cores e treino v1.10", () => {
  it("código de perfil vai e volta e rejeita lixo", () => {
    const tuning = { ...DEFAULT_SETTINGS.profiles[0].tuning, emphasis: "red" as const, emphasisStrength: 40, gamma: 120 };
    const code = encodeProfile({ vibrance: 130, tuning });
    expect(code.startsWith("GF1-")).toBe(true);
    const back = decodeProfile(code)!;
    expect(back.vibrance).toBe(130);
    expect(back.tuning.emphasis).toBe("red");
    expect(back.tuning.gamma).toBe(120);
    expect(decodeProfile("GF1-!!!")).toBeNull();
    expect(decodeProfile("oi")).toBeNull();
    expect(decodeProfile("GF1-" + btoa("999.9.0.0.100.100"))).toBeNull();
  });

  it("sequência de dias e melhor por dia", () => {
    const day = 86_400_000;
    const now = new Date(2026, 10, 18, 15).getTime();
    const r = (daysAgo: number, score: number, mode: TrainResult["mode"] = "flick"): TrainResult => ({ mode, score, at: now - daysAgo * day });
    expect(streak([r(0, 10), r(1, 10), r(2, 10), r(4, 10)], now)).toBe(3);
    expect(streak([r(1, 10), r(2, 10)], now)).toBe(2); // ainda não treinou hoje
    expect(streak([r(3, 10)], now)).toBe(0);
    const d = dailyBest([r(0, 20), r(0, 25), r(2, 15), r(20, 99)], "flick", 7, now);
    expect(d).toEqual([null, null, null, null, 15, null, 25]);
    expect(dailyBest([r(0, 250, "reaction"), r(0, 210, "reaction")], "reaction", 1, now)).toEqual([210]);
  });

  it("novos modos de mira e abas de evolução e visibilidade", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Treino" }));
    await userEvent.click(screen.getByRole("tab", { name: "Mira" }));
    await userEvent.click(screen.getByRole("radio", { name: "Peek" }));
    expect(screen.getByText(/entra pela borda/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Pequeno" }));
    await userEvent.click(screen.getByRole("tab", { name: "Evolução" }));
    expect(screen.getByText(/dia\(s\) seguidos/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Visibilidade" }));
    await userEvent.click(screen.getByRole("button", { name: "Silhueta 1" }));
    expect(screen.getByText("Achou 1 de 8")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Mouse" }));
    expect(screen.getByText("Calculadora de DPI")).toBeInTheDocument();
  });
});

describe("Conforto v1.11", () => {
  it("boas-vindas em 3 passos salva escolhas", async () => {
    localStorage.setItem("goat-filter:settings", JSON.stringify({ ...DEFAULT_SETTINGS, onboarded: false }));
    await renderApp();
    const dlg = await screen.findByRole("dialog", { name: "Bem-vindo ao Goat Filter" });
    await userEvent.click(within(dlg).getByRole("radio", { name: /Super/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Próximo" }));
    await userEvent.click(within(dlg).getByRole("switch", { name: "Ligar o replay instantâneo" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Próximo" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Começar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const saved = JSON.parse(localStorage.getItem("goat-filter:settings")!);
    expect(saved.onboarded).toBe(true);
    expect(saved.recorder.replay).toBe(true);
    expect(saved.profiles[0].vibrance).toBe(120);
  });

  it("OLED e voltar tudo ao normal com confirmação", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Configurações" }));
    const oledRow = screen.getByText("Fundo preto (telas OLED)").closest(".row") as HTMLElement;
    await userEvent.click(within(oledRow).getByRole("switch"));
    await waitFor(() => expect(document.documentElement.dataset.oled).toBe("true"));
    await userEvent.click(screen.getByRole("button", { name: "Voltar ao normal" }));
    await userEvent.click(screen.getByRole("button", { name: "Clique de novo para confirmar" }));
    expect(await screen.findByText("Tudo voltou ao normal.", { selector: ".toast" })).toBeInTheDocument();
  });
});

describe("Miras prontas", () => {
  it("todos os códigos do catálogo são válidos e únicos", () => {
    const codes = CROSSHAIR_PRESETS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(isCrosshairCode(c)).toBe(true);
    expect(CROSSHAIR_PRESETS.filter((p) => p.kind === "pro").length).toBeGreaterThanOrEqual(8);
  });

  it("lê o código e desenha a mira", () => {
    // seção S (sniper) não mistura com a principal
    expect(primaryValues("0;s;1;P;c;5;h;0;S;c;1;o;1").get("c")).toBe("5");
    const tenz = parseCrosshair("0;s;1;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0");
    expect(tenz.color).toBe("#00ffff");
    expect(tenz.outline).toBe(false);
    expect(tenz.inner).toMatchObject({ show: true, length: 4, offset: 2, alpha: 1, thickness: 2 });
    expect(tenz.outer.show).toBe(false);
    expect(crosshairRects(tenz)).toHaveLength(4);
    // cor personalizada e ponto com contorno
    const less = parseCrosshair("0;P;c;8;u;000000FF;h;0;b;1;f;0;0l;4;0v;3;0o;0;0a;1;0f;0;1b;0");
    expect(less.color).toBe("#000000");
    expect(less.inner.vertical).toBe(3);
    const dot = parseCrosshair("0;P;c;1;s;1;d;1;z;2;a;1;0b;0;1b;0");
    const r = crosshairRects(dot);
    expect(r).toHaveLength(2); // contorno + ponto
    expect(r[0].fill).toBe("#000000");
  });

  it("filtra, copia e salva uma mira pronta", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Treino" }));
    await userEvent.click(screen.getByRole("tab", { name: "Miras" }));
    await userEvent.click(screen.getByRole("radio", { name: "Pros" }));
    await userEvent.type(screen.getByLabelText("Buscar mira"), "tenz");
    const grid = screen.getByRole("list", { name: "Miras prontas" });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(within(grid).getByRole("button", { name: "Salvar TenZ em Minhas miras" }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).crosshairs[0]).toMatchObject({ name: "TenZ", code: CROSSHAIR_PRESETS[0].code }),
    );
    expect(within(grid).getByRole("button", { name: "Salvar TenZ em Minhas miras" })).toBeDisabled();
  });
});

describe("Resolução esticada", () => {
  it("escolhe 4:3 no perfil e salva", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Perfis" }));
    const sel = await screen.findByLabelText("Resolução esticada");
    await waitFor(() => expect(within(sel).getAllByRole("option").length).toBeGreaterThan(2));
    await userEvent.selectOptions(sel, "1280x960");
    expect(screen.getByRole("button", { name: "Testar por 10 s" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).profiles[0].stretch).toEqual({ width: 1280, height: 960 }));
    await userEvent.selectOptions(sel, "");
    expect(screen.queryByRole("button", { name: "Testar por 10 s" })).not.toBeInTheDocument();
  });
});

describe("Teste de gravação", () => {
  it("mostra imagem, som do PC e microfone", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Gravação" }));
    await userEvent.click(screen.getByRole("button", { name: "Testar gravação" }));
    const list = await screen.findByRole("list", { name: "Resultado do teste" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText(/Som do PC/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar relatório" })).toBeInTheDocument();
  });
});

describe("Configurações", () => {
  it("troca o método do Super Vibrance e persiste", async () => {
    await renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Configurações" }));
    const mhc2 = screen.getByRole("radio", { name: /Perfil de cor MHC2/ });
    expect(mhc2).toHaveAttribute("aria-checked", "false");
    await userEvent.click(mhc2);
    expect(mhc2).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse(localStorage.getItem("goat-filter:settings")!).superMethod).toBe("mhc2");
    expect(useStore.getState().capabilities.superMethod).toBe("mhc2");
  });
});

describe("regras de vibrance", () => {
  it("mesmas regras do núcleo em Rust", () => {
    expect(matrixFactor(75, "nvidia")).toBe(1);
    expect(matrixFactor(150, "nvidia")).toBeCloseTo(1.5);
    expect(matrixFactor(200, "nvidia")).toBeCloseTo(2);
    expect(matrixFactor(50, "none")).toBe(1);
    expect(matrixFactor(200, "none")).toBeCloseTo(2.5);
  });
});

// evita aviso de act() pendente do toast
afterEach(() => act(() => useStore.setState({ toast: null })));
