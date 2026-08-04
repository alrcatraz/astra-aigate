import Link from "next/link";
import { Metadata } from "next";
import { source } from "@/lib/source";
import { APP_CONFIG } from "@/shared/constants/config";

export const metadata: Metadata = {
  title: `${APP_CONFIG.name} Documentation`,
  description:
    "Everything you need to route, compress, and scale your AI — API reference, architecture, compression, and more.",
  openGraph: {
    title: `${APP_CONFIG.name} Documentation`,
    description: `Comprehensive docs for ${APP_CONFIG.name} — API, architecture, compression, and more.`,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_CONFIG.name} Documentation`,
    description: `Comprehensive docs for ${APP_CONFIG.name}`,
  },
};

const featuredLinks = [
  {
    href: "/docs/reference/api-reference",
    title: "API Reference",
    icon: "code",
    desc: "Full API endpoint reference with auth model",
  },
  {
    href: "/docs/architecture/architecture",
    title: "Architecture",
    icon: "account_tree",
    desc: "High-level architecture, subsystem map, dashboard surface",
  },
  {
    href: "/docs/compression/compression-guide",
    title: "Compression Guide",
    icon: "auto_awesome",
    desc: "Prompt compression modes and engines",
  },
];

const sections = [
  {
    title: "Architecture & Reference",
    subtitle: "Deep dive into architecture, APIs, and internals",
    icon: "code",
    color: "blue",
    folders: ["architecture", "reference", "frameworks", "routing", "security", "compression"],
  },
];

export default function DocsHomePage() {
  const pages = source.getPages();

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="text-center mb-16 mt-8">
        <h1 className="text-4xl font-bold text-fd-foreground mb-5">
          {APP_CONFIG.name} Documentation
        </h1>
        <p className="text-lg text-fd-muted-foreground mb-6">
          Everything you need to route, compress, and scale your AI
        </p>
        <p className="text-sm text-fd-muted-foreground">
          Press{" "}
          <kbd className="px-1.5 py-0.5 bg-fd-muted border border-fd-border rounded font-mono text-xs">
            Ctrl K
          </kbd>{" "}
          to search the docs
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-16">
        {featuredLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center text-center p-6 bg-fd-card border border-fd-border rounded-xl
              hover:border-fd-primary hover:bg-fd-accent transition-all group"
          >
            <span className="material-symbols-outlined text-3xl text-fd-primary mb-3">
              {link.icon}
            </span>
            <span className="font-semibold text-fd-foreground group-hover:text-fd-primary transition-colors">
              {link.title}
            </span>
            <span className="text-sm text-fd-muted-foreground mt-2">{link.desc}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pb-12">
        {sections.map((section) => {
          const sectionPages = pages.filter((p) =>
            section.folders.some((folder) => p.url.startsWith(`/docs/${folder}/`))
          );
          return (
            <div
              key={section.title}
              className="border border-fd-border rounded-xl p-6 hover:border-fd-primary/30 transition-colors bg-fd-card/50"
            >
              <div className="flex items-center gap-3 mb-4">
                <span className="material-symbols-outlined text-2xl text-fd-primary">
                  {section.icon}
                </span>
                <div>
                  <h2 className="text-base font-semibold text-fd-foreground">{section.title}</h2>
                  <p className="text-sm text-fd-muted-foreground">{section.subtitle}</p>
                </div>
              </div>
              <ul className="space-y-2.5">
                {sectionPages.map((page) => (
                  <li key={page.url}>
                    <Link
                      href={page.url}
                      className="text-sm text-fd-muted-foreground hover:text-fd-primary transition-colors"
                    >
                      {page.data.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
