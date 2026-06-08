import React, { useEffect, useLayoutEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { useSession } from "../../context/SessionContext";
import { listDocuments, enqueueDocumentProcessing } from "../../lib/api/data";
import { documentProcessingFooterCopy } from "../../lib/documentProcessingUi";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";

import { UploadFile } from "../../components/ui/ManageDocuments/UploadFile";
import { ListDocuments } from "../../components/ui/ManageDocuments/ListDocuments";
import { RecordVoiceNote } from "../../components/ui/ManageDocuments/RecordVoiceNote";
import { spacing, radius, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";

type Props = NativeStackScreenProps<AppStackParamList, "ManageDocuments">;

export function ManageDocumentsScreen({ navigation }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { user } = useSession();

  const [refreshKey, setRefreshKey]     = useState(0);
  const [starting, setStarting]         = useState(false);
  const [msg, setMsg]                   = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const footerCopy = documentProcessingFooterCopy({ starting, pendingCount, message: msg });

  // Sync pending badge into the native navigation header
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View
          style={[
            styles.badge,
            pendingCount > 0 ? styles.badgeActive : styles.badgeIdle,
          ]}
        >
          <AppText
            variant="label"
            style={{ color: pendingCount > 0 ? colors.teal : colors.subtle }}
          >
            {pendingCount} pending
          </AppText>
        </View>
      ),
    });
  }, [navigation, pendingCount, styles, colors]);

  async function loadPendingCount() {
    if (!user) return;

    const { results } = await listDocuments("status=uploaded");
    setPendingCount((results ?? []).length);
  }

  useEffect(() => {
    loadPendingCount();
  }, [refreshKey]);

  const startProcessing = async () => {
    setMsg(null);
    setStarting(true);

    try {
      if (!user) throw new Error("Not signed in");

      const { results: pending } = await listDocuments("status=uploaded&ordering=created_at");

      const ids = (pending ?? []).map((r: any) => String(r.id));
      if (ids.length === 0) {
        setMsg("No pending items. Upload a file or save a change in Medical Profile first.");
        return;
      }

      await enqueueDocumentProcessing(ids);

      setMsg(`Started processing ${ids.length} item(s).`);

      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to start processing.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen edges={["left", "right", "bottom"]} style={styles.screen}>
      {/* List */}
      <View style={styles.list}>
        <ListDocuments
          refreshKey={refreshKey}
          onPendingCountChange={setPendingCount}
          header={
            <>
              <UploadFile onUploaded={() => setRefreshKey((k) => k + 1)} />
              <RecordVoiceNote onUploaded={() => setRefreshKey((k) => k + 1)} />
            </>
          }
        />
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        {msg ? (
          <AppText variant="caption" style={styles.msg}>{msg}</AppText>
        ) : null}

        <PrimaryButton
          label={footerCopy.buttonLabel}
          onPress={startProcessing}
          disabled={footerCopy.disabled}
          tone="teal"
          style={styles.processBtn}
        />

        {footerCopy.hint ? (
          <AppText variant="caption" style={styles.noFiles}>
            {footerCopy.hint}
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  screen: { flex: 1 },

  badge: {
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:      radius.pill,
    borderWidth:       StyleSheet.hairlineWidth,
  },
  badgeActive: {
    backgroundColor: c.tealSoft,
    borderColor:     c.tealBorder,
  },
  badgeIdle: {
    backgroundColor: "transparent",
    borderColor:     c.border,
  },

  list: { flex: 1 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bg,
    gap: spacing.xs,
  },
  processBtn: {
    width: "100%",
    shadowColor: c.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  msg: {
    textAlign: "center",
    color: c.teal,
    fontWeight: typescale.weight.medium,
  },
  noFiles: {
    textAlign: "center",
    color: c.muted,
    paddingHorizontal: spacing.md,
  },
}));
