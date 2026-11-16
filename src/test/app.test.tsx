import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import { createDemoApi, setNativeForTests } from "../lib/native";
import { matrixFactor } from "../lib/vibrance";
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
    const list = screen.getByRole("region", { name: "Gerenciador de perfis" });
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
