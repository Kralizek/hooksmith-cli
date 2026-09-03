import type { Config } from "@hooksmith/core";

export default {
  routes: [
    {
      name: "all-events",
      listeners: [
        {
          name: "capture-event",
          run(event) {
            return {
              success: true,
              message: `Processed ${event.type}`,
            };
          },
        },
      ],
    },
  ],
} satisfies Config;
