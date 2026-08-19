import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Marquee } from "../components/Marquee";

describe("Marquee", () => {
  it("renders two copies of its children for a seamless CSS-transform loop", () => {
    render(
      <Marquee>
        <span>BTC ▲ +$0.42</span>
      </Marquee>,
    );
    expect(screen.getAllByText("BTC ▲ +$0.42")).toHaveLength(2);
  });

  it("pauses on hover by default via the group-hover animation-play-state class", () => {
    const { container } = render(
      <Marquee>
        <span>item</span>
      </Marquee>,
    );
    const track = container.querySelector(".animate-marquee");
    expect(track?.className).toContain("group-hover:[animation-play-state:paused]");
  });

  it("skips the pause-on-hover class when pauseOnHover is false", () => {
    const { container } = render(
      <Marquee pauseOnHover={false}>
        <span>item</span>
      </Marquee>,
    );
    const track = container.querySelector(".animate-marquee");
    expect(track?.className).not.toContain("group-hover:[animation-play-state:paused]");
  });
});
