import { Path, UNFINISHED_INPUT } from "../constant";
import { IconButton } from "./button";
import styles from "./new-chat.module.scss";

import LeftIcon from "../icons/left.svg";
import EyeIcon from "../icons/eye.svg";
import ImageIcon from "../icons/image.svg";
import SendWhiteIcon from "../icons/send-white.svg";

import { useLocation, useNavigate } from "react-router-dom";
import { Skill, useSkillStore } from "../store/skill";
import Locale from "../locales";
import { useAppConfig, useChatStore } from "../store";
import { MaskAvatar } from "./mask";
import { useCommand } from "../command";
import { showConfirm } from "./ui-lib";
import { BUILTIN_SKILL_STORE } from "../skills";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { safeLocalStorage } from "../utils";

function SkillItem(props: { skill: Skill; onClick?: () => void }) {
  return (
    <div className={styles["mask"]} onClick={props.onClick}>
      <MaskAvatar
        avatar={props.skill.avatar}
        model={props.skill.modelConfig.model}
      />
      <div className={styles["mask-texts"]}>
        <div className={clsx(styles["mask-name"], "one-line")}>
          {props.skill.name}
        </div>
      </div>
    </div>
  );
}

const localStorage = safeLocalStorage();

export function NewChat() {
  const chatStore = useChatStore();
  const skillStore = useSkillStore();
  const [draft, setDraft] = useState("");

  const skills = skillStore.getAll();
  const featuredSkills = skills.slice(0, 8);
  const recentSkills = useMemo(() => {
    const seen = new Set<string>();
    return chatStore.sessions
      .slice()
      .sort((a, b) => b.lastUpdate - a.lastUpdate)
      .map((session) => session.mask as Skill | undefined)
      .filter((skill): skill is Skill => {
        if (!skill) return false;
        const hasSkillContent =
          skill.context?.length > 0 ||
          !!skill.description ||
          !!skill.category ||
          !!skill.starters?.length;
        if (!hasSkillContent) return false;
        const key = skill.id || skill.name;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
  }, [chatStore.sessions]);

  const navigate = useNavigate();
  const config = useAppConfig();

  const { state } = useLocation();

  const startChat = (skill?: Skill, initialInput = "") => {
    setTimeout(() => {
      if (chatStore.newSession(skill) !== false) {
        const input = initialInput.trim();
        const session = useChatStore.getState().sessions[0];
        if (input && session?.id) {
          localStorage.setItem(UNFINISHED_INPUT(session.id), input);
        }
        navigate(Path.Chat);
      }
    }, 10);
  };

  const startDraftChat = () => startChat(undefined, draft);

  useCommand({
    mask: (id) => {
      try {
        const skill = skillStore.get(id) ?? BUILTIN_SKILL_STORE.get(id);
        startChat(skill ?? undefined);
      } catch {
        console.error("[New Chat] failed to create chat from skill id=", id);
      }
    },
  });

  return (
    <div className={styles["new-chat"]}>
      <div className={styles["mask-header"]}>
        <IconButton
          icon={<LeftIcon />}
          text={Locale.NewChat.Return}
          onClick={() => navigate(Path.Home)}
        ></IconButton>
        {!state?.fromHome && (
          <IconButton
            text={Locale.NewChat.NotShow}
            onClick={async () => {
              if (await showConfirm(Locale.NewChat.ConfirmNoShow)) {
                startChat();
                config.update(
                  (config) => (config.dontShowMaskSplashScreen = true),
                );
              }
            }}
          ></IconButton>
        )}
      </div>
      <div className={styles["title"]}>{Locale.Home.NewChat}</div>

      <div className={styles["launch-panel"]}>
        <textarea
          className={styles["launch-input"]}
          value={draft}
          placeholder={Locale.NewChat.Placeholder}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              startDraftChat();
            }
          }}
        />
        <div className={styles["launch-actions"]}>
          <button
            className={styles["quick-action"]}
            onClick={() => navigate(Path.Sd)}
            type="button"
          >
            <ImageIcon />
            {Locale.NewChat.ImageTitle}
          </button>
          <button
            className={styles["send-action"]}
            onClick={startDraftChat}
            type="button"
          >
            {Locale.NewChat.BlankTitle}
            <SendWhiteIcon />
          </button>
        </div>
      </div>

      {recentSkills.length > 0 && (
        <>
          <div className={styles["section-title"]}>
            {Locale.NewChat.RecentTitle}
          </div>
          <div className={styles["recent-skills"]}>
            {recentSkills.map((skill) => (
              <SkillItem
                key={skill.id}
                skill={skill}
                onClick={() => startChat(skill)}
              />
            ))}
          </div>
        </>
      )}

      <div className={styles["section-header"]}>
        <div>
          <div className={styles["section-title"]}>
            {Locale.NewChat.FeaturedTitle}
          </div>
        </div>
        <IconButton
          text={Locale.NewChat.More}
          onClick={() => navigate(Path.Skills)}
          icon={<EyeIcon />}
          bordered
        />
      </div>

      <div className={styles["featured-masks"]}>
        {featuredSkills.map((skill) => (
          <SkillItem
            key={skill.id}
            skill={skill}
            onClick={() => startChat(skill)}
          />
        ))}
      </div>
    </div>
  );
}
