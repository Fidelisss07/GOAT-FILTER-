import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import { createDemoApi, setNativeForTests } from "../lib/native";
import { matrixFactor } from "../lib/vibrance";
import { cmPer360, convertSens } from "../lib/sens";
import { bitrateKbps, formatClock, outputSize } from "../lib/rec";
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
    const row = (await screen.findByText("Modo de Jogo do Windows")).closest(".row") as HTMLElement;
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
    expect(screen.getByText("0.471")).toBeInTheDocument();
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
